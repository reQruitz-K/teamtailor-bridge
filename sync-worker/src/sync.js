import { WebflowClient } from './webflow.js';
import { TeamTailorClient } from './teamtailor.js';

export async function syncJob(jobId, env, jobData = null, resolvedLocationName = null, existingItem = null) {
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

        // 2. Resolve Location Name
        let locationName = resolvedLocationName || "";
        if (!resolvedLocationName && job.relationships.locations && job.relationships.locations.data && job.relationships.locations.data.length > 0) {
            // Only fetch if we have 'ttData' context (from single fetch)
            if (ttData) {
                const locationId = job.relationships.locations.data[0].id;
                const locationObj = TeamTailorClient.getIncludedResource(ttData, 'locations', locationId);
                if (locationObj) {
                    locationName = locationObj.attributes.name;
                }
            }
        }

        // 3. Map Data
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
            "updated-at": job.attributes['updated-at'] || ""
        };

        if (job.attributes.picture && job.attributes.picture.original) {
            fieldData["main-image"] = {
                "url": job.attributes.picture.original,
                "alt": job.attributes.title
            };
        }

        // 4. Upsert
        let itemToUpdate = existingItem;
        if (!itemToUpdate) {
             itemToUpdate = await wfClient.findJobByTeamTailorId(job.id);
        }

        if (itemToUpdate) {
            // Efficiency Check: Compare 'updated-at'
            const existingTimestamp = itemToUpdate.fieldData['updated-at'];
            const newTimestamp = fieldData['updated-at'];

            if (existingTimestamp === newTimestamp) {
                console.log(`[Sync] Skipping Item ${itemToUpdate.id} (Up to date: ${newTimestamp})`);
                return; // SKIP UPDATE & PUBLISH
            }

            console.log(`[Sync] Updating Webflow Item ${itemToUpdate.id}...`);
            await wfClient.updateItem(itemToUpdate.id, fieldData);
            console.log(`[Sync] Publishing Webflow Item ${itemToUpdate.id}...`);
            await wfClient.publishItem(itemToUpdate.id);
        } else {
            console.log(`[Sync] Creating new Webflow Item...`);
            const newItem = await wfClient.createItem(fieldData);
            console.log(`[Sync] Publishing Webflow Item ${newItem.id}...`);
            await wfClient.publishItem(newItem.id);
        }

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
            console.log(`[Delete] Found Webflow Item ${existingItem.id}. Archiving...`);
            // We verify if we should delete or archive. Usually Archive is safer, but user asked for "remove".
            // Webflow API v2 allows Archive via updating 'isArchived: true'.
            // Let's Archive it for safety.
            
            await wfClient.updateItem(existingItem.id, {}, true); // Pass true for isArchived
            console.log(`[Delete] Job archived successfully.`);
        } else {
            console.log(`[Delete] Job ${jobId} not found in Webflow. Nothing to do.`);
        }
    } catch (error) {
        console.error(`[Delete] Failed to delete Job ${jobId}:`, error);
        throw error;
    }
}
