import { WebflowClient } from './webflow.js';
import { TeamTailorClient } from './teamtailor.js';

function slugify(str) {
    return String(str)
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

const PRIMARY_LOCALE_ID = '662123573a11a37d76a9f412';
const SECONDARY_LOCALES = [
    { tag: 'fi', id: '665cb20748cb746631bffd66' },
    { tag: 'sv', id: '69b282e8dac0c1bbda31232c' }
];
const ALL_LOCALE_IDS = [PRIMARY_LOCALE_ID, ...SECONDARY_LOCALES.map(l => l.id)];

export async function syncJob(jobId, env, jobData = null, resolvedLocationName = null, existingItem = null, resolvedQuestionsJson = null, skipPublish = false) {
    console.log(`[Sync] Starting sync for Job ID: ${jobId}`);

    // If inputs not provided (e.g. from Webhook), instantiate clients and fetch
    const ttClient = new TeamTailorClient(env.TEAMTAILOR_API_KEY);
    const wfClient = new WebflowClient(env.WEBFLOW_API_TOKEN, env.WEBFLOW_COLLECTION_ID);

    try {
        let job = jobData;
        let ttData = null; // We might need this for inclusions if jobData provided is just attributes

        if (!job) {
             // Fallback for Webhooks (single job sync)
            ttData = await ttClient.getJob(jobId);
            job = ttData.data;
        } else {
            // If jobData provided (Bulk Sync), we wrap it in a structure for helper if needed
            // Actually, the helper needs the 'included' array.
            // When we fetch AllJobs, the 'included' is top level.
            // So we need to pass 'included' or the full response object if we want to resolve locations.
            // Let's assume jobData is the 'job' object, but we need 'included' too.
            // Refactor Idea: pass 'ttData' (full response) to syncJob if possible?
            // Or just pass 'locationName' resolved?
            // Simplest: Pass 'job' and 'locationName' resolved by caller?
            // Or pass 'included' array.
        }

        if (!job) {
            console.error(`[Sync] Job ${jobId} not found in TeamTailor.`);
            return;
        }

        // Guard: only archive jobs that are truly closed/inactive (not hidden/internal which are still open)
        const humanStatus = job.attributes['human-status'];
        const TERMINAL_STATUSES = new Set(['closed', 'draft', 'archived', 'template']);
        if (humanStatus && TERMINAL_STATUSES.has(humanStatus)) {
            console.log(`[Sync] Job ${jobId} is terminal (human-status=${humanStatus}). Archiving from Webflow...`);
            await deleteJob(jobId, env);
            return;
        }

        // REFACTOR: We need location resolution.
        // If jobData is passed, we assume the caller handled location resolution OR provided 'included' context.
        // Let's change signature to syncJob(jobId, env, jobObject, resolvedLocationName, preFetchedExistingItem)
        // But for webhook, we don't have these.
        
        // Let's stick to: syncJob(jobId, env, context = {})
        // context = { job: ..., included: ..., existingItem: ... }
        
        // But for now, let's keep it simple.
        // If jobData is passed, it is the 'data' part of a job resource.
        // We need 'included' to resolve location.
        
        console.log(`[Sync] Processing Job: ${job.attributes.title}`);

        // 2. Resolve Location & Questions
        let locationName = resolvedLocationName || "";
        let questionsJson = resolvedQuestionsJson || "";

        // Context Data (either passed via ttData or jobData which might imply inclusions if passed correctly)
        // If we are in Sync (Webhook), `ttData` is the FULL response with `included`.
        // If we are in Reconcile, `job` is just the data item, but we need `included` from the main response.
        // For Reconcile, we probably need to handle `questions` resolution differently if `ttData` isn't passed fully?
        // Wait, in `reconcileAllJobs`, we do: 
        // `await syncJob(job.id, env, job, locationName, existingItem);` 
        // We calculate locationName there. We do NOT pass the `included` array for questions.
        // WE NEED TO FIX `reconcileAllJobs` in `index.js` to pass data OR calculate questions there.
        // Better: Calculate questions in `index.js` (reconcile) OR pass `allJobsResponse` to `syncJob`.
        
        // Let's assume for now `ttData` (from webhook) exists for Webhook flow.
        if (ttData && ttData.included) {
             // Use Forward Link via picked-questions
             const linkedPickedIds = new Set(job.relationships['picked-questions']?.data?.map(i => i.id) || []);
             
             // Filter picked-questions. If linked IDs exist, use them. Else fallback (for single job context)
             // Note: In single job hook, 'job' variable is set earlier.
             const pickedQuestions = ttData.included.filter(item => 
                item.type === 'picked-questions' && 
                (linkedPickedIds.size === 0 || linkedPickedIds.has(item.id))
             );
             
             // Also get question defs
             const questionDefs = ttData.included.filter(item => item.type === 'questions');
             
             // Map picked-questions (Job -> Question join) to get mandatory status
             const jobQuestions = pickedQuestions.map(pq => {
                 const qId = pq.relationships.question?.data?.id;
                 const qDef = questionDefs.find(q => q.id === qId);
                 if (!qDef) return null;

                 return {
                     id: qDef.id,
                     label: qDef.attributes.label || qDef.attributes.title,
                     type: qDef.attributes['question-type'] || qDef.attributes['visual-type'] || qDef.attributes.type,
                     required: pq.attributes.mandatory, // Source of Truth
                     options: qDef.attributes.options || qDef.attributes.alternatives || [],
                     description: qDef.attributes.description,
                     config: {
                        min: qDef.attributes['start-with'] || qDef.attributes['min-value'],
                        max: qDef.attributes['end-with'] || qDef.attributes['max-value'],
                        unit: qDef.attributes.unit
                     }
                 };
             }).filter(Boolean);

             if (jobQuestions.length > 0) {
                 questionsJson = JSON.stringify(jobQuestions);
             }
        }
        
        // If resolvedLocationName is passed (Reconcile), we might miss questions if we don't handle it.
        // We will need to update `index.js` to pass a `questionsJson` string if possible, 
        // OR pass the `included` array to `syncJob`.
        // Let's UPDATE the signature to accept `questionsJson` directly to keep `syncJob` pure?
        // No, `syncJob` usually takes raw data.
        
        // Let's look at Lines 52-60 usage.
        if (!resolvedLocationName && job.relationships.locations && job.relationships.locations.data && job.relationships.locations.data.length > 0) {
            // Only fetch if we have 'ttData' context (from single fetch)
            if (ttData) {
                // Map ALL locations
                const locationIds = job.relationships.locations.data.map(l => l.id);
                const locationNames = locationIds.map(id => {
                    const locObj = TeamTailorClient.getIncludedResource(ttData, 'locations', id);
                    return locObj ? locObj.attributes.name : null;
                }).filter(Boolean); // Remove nulls

                if (locationNames.length > 0) {
                    locationName = locationNames.join(", ");
                }
            }
        }

        // 3. Map Data
        // Allow resolvedQuestionsJson to be passed from Reconcile loop
        // We need to update function signature in next step or assume it is passed in `resolvedLocationName` object? No.
        // Let's assume we update the function signature.
        

        const fieldData = {
            "name": job.attributes.title,
            "job-id": job.id,
            "title": job.attributes.title,
            "pitch": job.attributes.pitch || "",
            "body": job.attributes.body || "",
            "locations": locationName,
            "remote-status": job.attributes['remote-status'] || "",
            "apply-button-text": job.attributes['apply-button-text'] || "Apply",
            "internal-name": job.attributes['internal-name'] || "",
            "updated-at": job.attributes['updated-at'] || "",
            "internal": job.attributes.internal || false,
            "questions-json": questionsJson,
            "job-date": job.attributes['created-at'] || job.attributes['updated-at'] || "",
            "active": true
        };

        if (job.attributes.picture && job.attributes.picture.original) {
            fieldData["main-image"] = {
                "url": job.attributes.picture.original,
                "alt": job.attributes.title
            };
        }

        // 4. Upsert — Primary locale
        let itemToUpdate = existingItem;
        if (!itemToUpdate) {
            itemToUpdate = await wfClient.findJobByTeamTailorId(job.id);
        }

        let wasUpdated = false;

        if (itemToUpdate) {
            const existingTimestamp = itemToUpdate.fieldData['updated-at'];
            const newTimestamp = fieldData['updated-at'];
            const existingInternal = !!itemToUpdate.fieldData['internal'];
            const newInternal = !!fieldData['internal'];
            const existingQuestions = itemToUpdate.fieldData['questions-json'] || "";
            const newQuestions = fieldData['questions-json'] || "";
            const existingLocations = itemToUpdate.fieldData['locations'] || "";
            const newLocations = fieldData['locations'] || "";
            const existingJobDate = itemToUpdate.fieldData['job-date'] || "";
            const existingActive = !!itemToUpdate.fieldData['active'];

            const primaryUpToDate = existingTimestamp === newTimestamp &&
                existingInternal === newInternal &&
                existingQuestions === newQuestions &&
                existingLocations === newLocations &&
                existingActive === true &&
                !!existingJobDate &&
                !itemToUpdate.isArchived &&
                itemToUpdate.isDraft === false;

            if (primaryUpToDate) {
                console.log(`[Sync] Primary up to date for Item ${itemToUpdate.id}, syncing secondary locales...`);
            } else {
                wasUpdated = true;
                console.log(`[Sync] Updating Webflow Item ${itemToUpdate.id}...`);
                await wfClient.updateItem(itemToUpdate.id, fieldData);
            }
        } else {
            wasUpdated = true;
            console.log(`[Sync] Creating new Webflow Item...`);
            try {
                itemToUpdate = await wfClient.createItem(fieldData);
            } catch (createErr) {
                // Ghost slug from a previously deleted Webflow item.
                // First fallback: title-slug + job-id (was used in older sessions, may also be haunted).
                // Second fallback: job-{id} — deterministically unique and never used as a slug before.
                if (createErr.message && createErr.message.includes('Unique value is already in database')) {
                    const fallbackSlug = `${slugify(job.attributes.title)}-${job.id}`;
                    console.log(`[Sync] Slug collision for Job ${jobId}, retrying with slug: ${fallbackSlug}`);
                    try {
                        itemToUpdate = await wfClient.createItem({ ...fieldData, slug: fallbackSlug });
                    } catch (fallbackErr) {
                        if (fallbackErr.message && fallbackErr.message.includes('Unique value is already in database')) {
                            const safeSlug = `job-${job.id}`;
                            console.log(`[Sync] Fallback slug also taken, using safe slug: ${safeSlug}`);
                            itemToUpdate = await wfClient.createItem({ ...fieldData, slug: safeSlug });
                        } else {
                            throw fallbackErr;
                        }
                    }
                } else {
                    throw createErr;
                }
            }
        }

        // 5. Stage secondary locales, then publish once — so all three locale versions
        //    go live in a single publish call. (Reconcile skips publish here; does batch publish.)
        if (!skipPublish) {
            await Promise.all(SECONDARY_LOCALES.map(async ({ tag, id }) => {
                try {
                    await wfClient.updateItemForLocale(itemToUpdate.id, id, fieldData);
                    console.log(`[Sync] ${tag} locale staged for Item ${itemToUpdate.id}`);
                } catch (err) {
                    console.error(`[Sync] Failed ${tag} locale for Item ${itemToUpdate.id}:`, err.message);
                }
            }));

            console.log(`[Sync] Publishing Item ${itemToUpdate.id} (all locales)...`);
            const allLocales = ['662123573a11a37d76a9f412', ...SECONDARY_LOCALES.map(l => l.id)];
            for (const localeId of allLocales) {
                try {
                    await wfClient.publishItem([itemToUpdate.id], localeId);
                } catch (err) {
                    console.error(`[Sync] Failed to publish locale ${localeId} for Item ${itemToUpdate.id}:`, err.message);
                }
            }
        }

        // Return itemId + fieldData so reconcile can do locale updates after batch publish
        return { itemId: itemToUpdate.id, fieldData, wasUpdated };

    } catch (error) {
        console.error(`[Sync] Failed to sync Job ${jobId}:`, error);
        throw error;
    }
}

export async function deleteJob(jobId, env) {
    console.log(`[Delete] Starting deletion for Job ID: ${jobId}`);
    const wfClient = new WebflowClient(env.WEBFLOW_API_TOKEN, env.WEBFLOW_COLLECTION_ID);

    try {
        const existingItem = await wfClient.findJobByTeamTailorId(jobId);

        if (existingItem) {
            console.log(`[Delete] Found Webflow Item ${existingItem.id}. Archiving all locales...`);
            
            // Archive primary locale and set active to false
            await wfClient.updateItem(existingItem.id, { "active": false }, true, false); 
            
            // Archive secondary locales and set active to false
            for (const locale of SECONDARY_LOCALES) {
                try {
                    await wfClient.updateItemForLocale(existingItem.id, locale.id, { "active": false }, true, false);
                } catch (err) {
                    console.error(`[Delete] Failed to archive ${locale.tag} locale for Item ${existingItem.id}:`, err.message);
                }
            }
            
            // Publish the archived state so the item is removed from the live site
            const allLocales = ['662123573a11a37d76a9f412', ...SECONDARY_LOCALES.map(l => l.id)];
            for (const localeId of allLocales) {
                try {
                    await wfClient.publishItem([existingItem.id], localeId);
                } catch (err) {
                    console.error(`[Delete] Failed to publish archived locale ${localeId} for Item ${existingItem.id}:`, err.message);
                }
            }
            
            console.log(`[Delete] Job archived and published (removed from live site) for all locales.`);
            return existingItem.id; // Return the item ID for batch tracking
        } else {
            console.log(`[Delete] Job ${jobId} not found in Webflow. Nothing to do.`);
            return null;
        }
    } catch (error) {
        console.error(`[Delete] Failed to delete Job ${jobId}:`, error);
        throw error;
    }
}
