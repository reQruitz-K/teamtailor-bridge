import { syncJob, deleteJob } from './sync.js';
import { TeamTailorClient } from './teamtailor.js';
import { WebflowClient } from './webflow.js';
import { sleep, verifySignature } from './utils.js';

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

    // Loop and Sync
    for (const job of jobs) {
        try {
            // Resolve Location from 'included'
            let locationName = "";
            if (job.relationships.locations && job.relationships.locations.data && job.relationships.locations.data.length > 0) {
                const locationId = job.relationships.locations.data[0].id;
                const locationObj = TeamTailorClient.getIncludedResource(allJobsResponse, 'locations', locationId);
                if (locationObj) {
                    locationName = locationObj.attributes.name;
                }
            }

            const existingItem = wfMap.get(String(job.id));
            
            // Call syncJob with injected data. 
            await syncJob(job.id, env, job, locationName, existingItem);

            // Rate Limit Politeness
            await sleep(250);

        } catch (e) {
            console.error(`[Reconcile] Failed sync for ${job.id}`, e);
        }
    }
    
    console.log("[Reconcile] Full sync complete.");
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        if (request.method === 'POST') {
            try {
                // Verify Signature first
                if (env.TEAMTAILOR_WEBHOOK_SECRET) {
                    const verified = await verifySignature(request, env.TEAMTAILOR_WEBHOOK_SECRET);
                    if (!verified) {
                        console.error("[Webhook] Signature verification failed!");
                        return new Response("Unauthorized", { status: 401 });
                    }
                } else {
                     console.warn("[Webhook] No secret configured. Skipping verification.");
                }

                // Get Event Type from Header
                const eventType = request.headers.get("X-TeamTailor-Event"); // e.g., 'job.created', 'job.deleted'
                // We must clone because verifySignature consumed the body stream and we need json() now.
                // Wait, verifySignature used clone().text()... actually request.json() reads the original stream. 
                // Using request.clone() in verifySignature allows request.json() here to work if verifySignature was non-destructive to original.
                // Cloudflare Request.clone() allows multiple reads.
                const payload = await request.json();
                
                console.log(`[Webhook] Received Event: ${eventType}`);
                const jobId = payload.data?.id;

                if (!jobId) {
                    return new Response("No Job ID found", { status: 400 });
                }

                if (eventType === 'job.created' || eventType === 'job.updated') {
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

        // Manual Reconciliation Trigger (Protected)
        if (request.method === 'GET' && url.pathname === '/reconcile') {
            const key = url.searchParams.get('key');
            if (key !== env.TEAMTAILOR_API_KEY) { 
                return new Response("Unauthorized", { status: 401 });
            }

            console.log("[Manual] Triggering full reconciliation via HTTP...");
            ctx.waitUntil(reconcileAllJobs(env));

            return new Response("Full Reconciliation Triggered (Check Logs)", { status: 202 });
        }

        return new Response("TeamTailor-Webflow Sync Worker", { status: 200 });
    },

    async scheduled(event, env, ctx) {
        console.log("[Cron] Starting nightly reconciliation...");
        ctx.waitUntil(reconcileAllJobs(env));
    }
};
