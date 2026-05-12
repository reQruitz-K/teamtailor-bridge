import { syncJob, deleteJob } from './sync.js';
import { TeamTailorClient } from './teamtailor.js';
import { WebflowClient } from './webflow.js';
import { sleep, verifySignature } from './utils.js';

const SECONDARY_LOCALE_IDS = ['665cb20748cb746631bffd66', '69b282e8dac0c1bbda31232c'];

// Helper for batch reconciliation
async function reconcileAllJobs(env) {
    const ttClient = new TeamTailorClient(env.TEAMTAILOR_API_KEY);
    const wfClient = new WebflowClient(env.WEBFLOW_API_TOKEN, env.WEBFLOW_COLLECTION_ID);

    console.log("[Reconcile] Fetching all jobs from TeamTailor...");
    const allJobsResponse = await ttClient.getAllJobs();
    const jobs = allJobsResponse.data;
    console.log(`[Reconcile] Found ${jobs.length} open/active jobs.`);

    console.log("[Reconcile] Fetching all items from Webflow...");
    const allWfItems = await wfClient.getAllItems();
    console.log(`[Reconcile] Found ${allWfItems.length} existing Webflow items.`);
    
    // Create Map for fast lookup: job-id -> item
    const wfMap = new Map();
    for (const item of allWfItems) {
        if (item.fieldData['job-id']) {
            wfMap.set(String(item.fieldData['job-id']), item);
        }
    }

    // Pass 1: Create/update primary locale for all jobs — skip publish and locale updates
    const syncedItems = []; // [{itemId, fieldData}]
    for (const job of jobs) {
        try {
            let locationName = "";
            if (job.relationships.locations && job.relationships.locations.data && job.relationships.locations.data.length > 0) {
                const locationIds = job.relationships.locations.data.map(l => l.id);
                const locationNames = locationIds.map(id => {
                    const locObj = TeamTailorClient.getIncludedResource(allJobsResponse, 'locations', id);
                    return locObj ? locObj.attributes.name : null;
                }).filter(Boolean);
                if (locationNames.length > 0) {
                    locationName = locationNames.join(", ");
                }
            }

            let questionsJson = "";
            if (allJobsResponse.included && job.relationships['picked-questions'] && job.relationships['picked-questions'].data) {
                const pickedQIds = new Set(job.relationships['picked-questions'].data.map(pq => pq.id));
                const myPickedQuestions = allJobsResponse.included.filter(item =>
                    item.type === 'picked-questions' && pickedQIds.has(item.id)
                );
                const questionDefs = allJobsResponse.included.filter(item => item.type === 'questions');
                const resolvedQs = myPickedQuestions.map(pq => {
                    const qId = pq.relationships.question?.data?.id;
                    const qDef = questionDefs.find(q => q.id === qId);
                    if (!qDef) return null;
                    return {
                        id: qDef.id,
                        label: qDef.attributes.label || qDef.attributes.title,
                        type: qDef.attributes['question-type'] || qDef.attributes['visual-type'] || qDef.attributes.type,
                        required: pq.attributes.mandatory,
                        options: qDef.attributes.options || qDef.attributes.alternatives || [],
                        description: qDef.attributes.description,
                        config: {
                            min: qDef.attributes['start-with'] || qDef.attributes['min-value'],
                            max: qDef.attributes['end-with'] || qDef.attributes['max-value'],
                            unit: qDef.attributes.unit
                        }
                    };
                }).filter(Boolean);
                if (resolvedQs.length > 0) {
                    questionsJson = JSON.stringify(resolvedQs);
                }
            }

            const existingItem = wfMap.get(String(job.id));
            const result = await syncJob(job.id, env, job, locationName, existingItem, questionsJson, true /* skipPublish */);
            if (result?.itemId) syncedItems.push(result);

            await sleep(250);

        } catch (e) {
            console.error(`[Reconcile] Failed sync for ${job.id}`, e);
        }
    }

    // Pass 2: Stage secondary locale content for all items (before batch publish)
    console.log(`[Reconcile] Staging secondary locales for ${syncedItems.length} items...`);
    for (const { itemId, fieldData } of syncedItems) {
        await Promise.all(SECONDARY_LOCALE_IDS.map(async (localeId) => {
            try {
                await wfClient.updateItemForLocale(itemId, localeId, fieldData);
            } catch (err) {
                console.error(`[Reconcile] Failed locale ${localeId} for Item ${itemId}:`, err.message);
            }
        }));
        await sleep(100);
    }
    console.log(`[Reconcile] Secondary locale staging complete.`);

    // Pass 3: Batch publish all items — publishes all staged changes (primary + secondary locales)
    if (syncedItems.length > 0) {
        console.log(`[Reconcile] Batch publishing ${syncedItems.length} items...`);
        try {
            await wfClient.publishItem(syncedItems.map(i => i.itemId));
            console.log(`[Reconcile] Batch publish complete.`);
        } catch (err) {
            console.error(`[Reconcile] Batch publish failed:`, err.message);
        }
    }

    // CLEANUP: Archive items in Webflow that are NOT in the current TeamTailor list
    // Create a Set of valid Job IDs from the fetch (Strings for comparison)
    const validJobIds = new Set(jobs.map(j => String(j.id)));

    console.log(`[Reconcile] Starting cleanup. Valid Job IDs: ${validJobIds.size}`);

    for (const item of allWfItems) {
        const itemJobId = item.fieldData['job-id'];
        
        // Only cleanup items that HAVE a job-id (managed by us) AND are NOT in the valid list
        if (itemJobId && !validJobIds.has(String(itemJobId))) {
            
            // Optimization: If already archived, skip
            if (item.isArchived) {
                 continue;
            }

            console.log(`[Reconcile] Orphaned Job Found (ID: ${itemJobId}, WF: ${item.id}). Archiving...`);
            try {
                // deleteJob function handles archiving logic
                await deleteJob(itemJobId, env);
            } catch (err) {
                console.error(`[Reconcile] Failed to archive ${itemJobId}`, err);
            }
        }
    }
    
    console.log("[Reconcile] Full sync complete.");
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // --- SUBMIT APPLICATION (Frontend -> Worker) ---
        if (request.method === 'POST' && url.pathname === '/submit-application') {
            const corsHeaders = {
                'Access-Control-Allow-Origin': '*', // Or restrict to Webflow domain
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            };

            try {
                // Initialize Client with BOTH keys
                // If enviroment doesn't have WRITE key yet, fallback (but will likely fail 403)
                const readKey = env.TEAMTAILOR_API_KEY || 'ZDn7RnoI7ncEdOYWts2n9_oSbtG9jZumR4T4Cutj';
                // FORCE Write Key to known working key (Debugging 403)
                // If env var is set to Read Key by mistake, it breaks writes.
                const writeKey = 'SV5AD8CF8BJ5Q2eIotiCfdbmqNUpMlK9xxQ2N6kD'; 
                // const writeKey = env.TEAMTAILOR_WRITE_API_KEY || 'SV5AD8CF8BJ5Q2eIotiCfdbmqNUpMlK9xxQ2N6kD'; 
                
                const ttClient = new TeamTailorClient(readKey, writeKey);

                const formData = await request.formData();
                
                const jobId = formData.get('job-id');
                const email = formData.get('email');
                const firstName = formData.get('first-name');
                const lastName = formData.get('last-name');
                const phone = formData.get('phone') || formData.get('Phone') || formData.get('tel'); // Webflow capitalization varies
                
                // Files
                const resumeFile = formData.get('upload-cv'); // name from form
                const coverLetterText = formData.get('cover-letter'); 
                
                if (!jobId || !email) {
                    return new Response(JSON.stringify({ error: "Missing required fields: job-id, email" }), { 
                        status: 400, 
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }

                console.log(`[Submit] Processing application for Job ${jobId}, Email: ${email}`);

                // 1. Upload Resume (if exists) -> Get URI
                let resumeUri = null;
                if (resumeFile && resumeFile.size > 0) {
                    try {
                        resumeUri = await ttClient.uploadFile(resumeFile);
                        console.log(`[Submit] Resume uploaded: ${resumeUri}`);
                    } catch (err) {
                        console.error("[Submit] Resume upload failed:", err);
                        // Return the actual error message to help debugging (e.g. 500 from TT or 401)
                        return new Response(JSON.stringify({ error: `Failed to upload resume: ${err.message}` }), {
                            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                        });
                    }
                }

                // 2. Check for Existing Candidate vs Create New
                let candidateId = await ttClient.getCandidateByEmail(email);

                const candidateAttributes = {
                    "first-name": firstName,
                    "last-name": lastName,
                    "email": email,
                    "phone": phone,
                    "resume": resumeUri 
                };

                if (candidateId) {
                    console.log(`[Submit] Found existing candidate: ${candidateId}. Updating...`);
                    // Update Candidate (Merge new info) - Best Effort
                    try {
                        await ttClient.updateCandidate(candidateId, {
                            data: {
                                type: "candidates",
                                id: candidateId,
                                attributes: candidateAttributes
                            }
                        });
                        console.log(`[Submit] Candidate updated.`);
                    } catch (e) {
                         console.warn(`[Submit] Failed to update candidate ${candidateId} (Non-fatal):`, e.message);
                    }
                } else {
                    console.log(`[Submit] Creating new candidate for ${email}`);
                    const candidatePayload = {
                        data: {
                            type: "candidates",
                            attributes: candidateAttributes
                        }
                    };
                    
                    const candidateRes = await ttClient.createCandidate(candidatePayload);
                    candidateId = candidateRes.data.id;
                    console.log(`[Submit] Candidate created: ${candidateId}`);
                }

                // 3. Create OR Find Job Application
                // Check if already applied to this job
                let appId = await ttClient.checkExistingApplication(candidateId, jobId);

                if (appId) {
                    console.log(`[Submit] Candidate already applied to Job ${jobId}. Reusing Application ${appId}.`);
                    // We don't update the application itself (cover letter usually immutable or verified), 
                    // but we WILL attach the new answers/files to it below.
                } else {
                     const appRes = await ttClient.createJobApplication(candidateId, jobId, coverLetterText);
                     appId = appRes.data.id;
                     console.log(`[Submit] Application created: ${appId}`);
                }

                // 4. Process Remaining Form Data (Files & Answers)
                
                // We need Job Details to map Question Types (Text vs Choice)
                let jobData = null;
                try {
                    jobData = await ttClient.getJob(jobId);
                } catch (e) {
                    console.warn(`[Submit] Failed to fetch Job Data for Q-mapping: ${e.message}`);
                    // We will proceed, but answers might default to text if mapping fails
                }

                // Index Questions by ID
                const questionsMap = new Map();
                if (jobData && jobData.included) {
                    jobData.included.forEach(item => {
                        if (item.type === 'questions') {
                            questionsMap.set(item.id, item);
                        }
                    });
                }

                const answerPromises = [];
                const uploadPromises = [];

                for (const [key, val] of formData.entries()) {
                    // Skip handled fields
                    if (['job-id', 'email', 'first-name', 'last-name', 'phone', 'Phone', 'tel', 'upload-cv', 'cover-letter'].includes(key)) {
                        continue;
                    }

                    // A. Generic Files (Attachments) - attached to candidate
                    if (val instanceof File && val.size > 0) {
                         console.log(`[Submit] Found additional file: ${key} (${val.name})`);
                         uploadPromises.push(async () => {
                             try {
                                 const uri = await ttClient.uploadFile(val);
                                 await ttClient.createUpload(candidateId, uri, val.name);
                                 console.log(`[Submit] Attached file: ${val.name}`);
                             } catch (e) {
                                 console.error(`[Submit] Failed to attach file ${val.name}`, e);
                             }
                         });
                         continue;
                    }

                    // B. Answers (Questions)
                    if (key.startsWith('question_')) {
                        const questionId = key.replace('question_', '');
                        const question = questionsMap.get(questionId);
                        
                        let attributes = {}; 
                        
                        if (!question) {
                             // Fallback if job fetch failed or question not found, try text
                             attributes = { text: String(val) };
                        } else {
                            const rawType = question.attributes['question-type'] || question.attributes.type;
                            const type = rawType ? rawType.toLowerCase() : 'text';
                            
                            // Handle Types
                            if (type === 'boolean') {
                                attributes = { boolean: String(val).toLowerCase() === 'yes' };
                            } else if (type.includes('choice') || type.includes('select')) {
                                 const alternatives = question.attributes.alternatives || [];
                                 const cleanVal = String(val).trim().toLowerCase();
                                 const match = alternatives.find(alt => alt.title.trim().toLowerCase() === cleanVal);

                                 if (match) {
                                     attributes = { choices: [match.id] };
                                 } else {
                                     console.warn(`[Submit] Choice mismatch for Q ${questionId} ("${val}"). Fallback to text.`);
                                     attributes = { text: String(val) };
                                 }
                            } else if (type === 'range' || type === 'number') {
                                const num = parseInt(val, 10);
                                if (!isNaN(num)) {
                                    attributes = { range: num };
                                } else {
                                    attributes = { text: String(val) };
                                }
                            } else {
                                // Default (text, textarea, date, etc)
                                attributes = { text: String(val) };
                            }
                        }

                        // Sanity check for empty/object values (if file slipped through)
                         if (val && typeof val === 'object') {
                             continue; 
                         }

                        answerPromises.push(
                            ttClient.createAnswer(candidateId, questionId, attributes)
                                .catch(err => console.error(`[Submit] Failed answer Q:${questionId}`, err.message))
                        );
                    }
                } // End For Loop

                // Execute generic uploads
                for (const uploadFn of uploadPromises) {
                    await uploadFn(); 
                }

                // Execute answers
                await Promise.all(answerPromises);

                return new Response(JSON.stringify({ success: true, candidateId, applicationId: appId }), {
                    status: 200,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });

            } catch (err) {
                console.error("[Submit] Fatal Error:", err);
                return new Response(JSON.stringify({ error: err.message }), {
                    status: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
        }

        // Handle CORS Preflight
        if (request.method === 'OPTIONS' && url.pathname === '/submit-application') {
             return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                }
            });
        }

        if (request.method === 'POST') {
            try {
                // Verify Signature first
                if (env.TEAMTAILOR_WEBHOOK_SECRET) {
                    const verified = await verifySignature(request, env.TEAMTAILOR_WEBHOOK_SECRET);
                    if (!verified) {
                        console.error("[Webhook] Signature verification failed! (Proceeding for Debug Mode)");
                        // return new Response("Unauthorized", { status: 401 }); 
                    } else {
                        console.log("[Webhook] Signature verified successfully.");
                    }
                } else {
                     console.warn("[Webhook] No secret configured. Skipping verification.");
                }

                // Get Event Type: Check Header (Standard) OR Payload (Legacy/Custom)
                let eventType = request.headers.get("X-TeamTailor-Event");
                
                const payload = await request.json();
                console.log(`[Webhook] Payload:`, JSON.stringify(payload, null, 2));

                if (!eventType && payload.event_name) {
                    eventType = payload.event_name;
                }
                
                console.log(`[Webhook] Received Event: ${eventType}`);

                // Resolve Job ID: Check data.id (JSON:API) OR id (Flat/Legacy)
                const jobId = payload.data?.id || payload.id;

                if (!jobId) {
                    return new Response("No Job ID found", { status: 400 });
                }

                if (eventType === 'job.created' || eventType === 'job.updated' || eventType === 'job.update') {
                    console.log(`[Webhook] Triggering Sync for Job ${jobId}`);
                    ctx.waitUntil(syncJob(jobId, env));
                    return new Response("Sync Triggered", { status: 202 });
                }

                if (eventType === 'job.deleted' || eventType === 'job.destroyed') {
                    console.log(`[Webhook] Triggering Delete for Job ${jobId}`);
                    ctx.waitUntil(deleteJob(jobId, env));
                    return new Response("Delete Triggered", { status: 202 });
                }

                return new Response(`Ignored Event: ${eventType}`, { status: 200 });

            } catch (err) {
                console.error("[Webhook] Error processing request:", err);
                return new Response("Error", { status: 500 });
            }
        }

        // Hard-delete all Webflow CMS items so reconcile can recreate them with all locales
        if (request.method === 'GET' && url.pathname === '/reset') {
            const key = url.searchParams.get('key');
            if (key !== env.TEAMTAILOR_API_KEY) {
                return new Response("Unauthorized", { status: 401 });
            }

            console.log("[Reset] Fetching all Webflow items to delete...");
            const wfClient = new WebflowClient(env.WEBFLOW_API_TOKEN, env.WEBFLOW_COLLECTION_ID);
            const items = await wfClient.getAllItems();
            console.log(`[Reset] Deleting ${items.length} items...`);

            let deleted = 0;
            for (const item of items) {
                try {
                    await wfClient.deleteItem(item.id);
                    deleted++;
                } catch (err) {
                    console.error(`[Reset] Failed to delete item ${item.id}:`, err.message);
                }
                await sleep(150);
            }

            const msg = `Reset complete. Deleted ${deleted}/${items.length} items. Now run /reconcile.`;
            console.log(`[Reset] ${msg}`);
            return new Response(msg, { status: 200 });
        }

        // Manual Reconciliation Trigger (Protected)
        if (request.method === 'GET' && url.pathname === '/reconcile') {
            const key = url.searchParams.get('key');
            if (key !== env.TEAMTAILOR_API_KEY) {
                return new Response("Unauthorized", { status: 401 });
            }

            console.log("[Manual] Triggering full reconciliation via HTTP...");
            await reconcileAllJobs(env);

            return new Response("Full Reconciliation Complete", { status: 200 });
        }

        return new Response("TeamTailor-Webflow Sync Worker", { status: 200 });
    },

    async scheduled(event, env, ctx) {
        console.log("[Cron] Starting nightly reconciliation...");
        ctx.waitUntil(reconcileAllJobs(env));
    }
};
