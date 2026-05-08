export class TeamTailorClient {
    constructor(apiKey, writeApiKey = null) {
        this.apiKey = apiKey;
        this.writeApiKey = writeApiKey || apiKey; // Fallback to apiKey if no specific write key (though user said read-only)
        this.baseUrl = 'https://api.teamtailor.com/v1';
        this.apiVersion = '20210218';
    }

    async getHeaders(useWriteKey = false) {
        return {
            'Authorization': `Token token=${useWriteKey ? this.writeApiKey : this.apiKey}`,
            'X-Api-Version': this.apiVersion,
            'Content-Type': 'application/vnd.api+json'
        };
    }

    async getJob(jobId) {
        // Fetch single job with all necessary includes
        // Use picked-questions.question to get mandatory status AND question details
        const include = 'locations,department,role,user,picked-questions.question';
        const url = `${this.baseUrl}/jobs/${jobId}?include=${include}`;
        
        const headers = await this.getHeaders(false);
        const response = await fetch(url, { headers });

        if (!response.ok) {
            throw new Error(`TeamTailor Fetch Error: ${response.status} ${response.statusText}`);
        }

        return await response.json();
    }

    async getAllJobs() {
        // Used for the Cron Job reconciliation
        // Fetches 'published' and 'internal' (via feed) jobs
        // Target scope: Public Published + Internal Published (~15 jobs)
        const include = 'locations,picked-questions.question';
        const pageSize = '30'; // Ensure we get as many as possible per page

        const fetchAllPages = async (urlStr) => {
            const url = new URL(urlStr);
            url.searchParams.set('include', include);
            url.searchParams.set('page[size]', pageSize);
            
            const headers = await this.getHeaders(false);
            let nextUrl = url.toString();
            const allData = [];
            const includedMap = [];

            while (nextUrl) {
                console.log(`[TeamTailor] Fetching: ${nextUrl}`);
                const response = await fetch(nextUrl, { headers });

                if (!response.ok) {
                    const text = await response.text();
                    // If 404/400 on a feed, maybe just ignore or log? 
                    // But for now throw to be safe, unless it's a known empty state.
                    throw new Error(`TeamTailor List Error: ${response.status} ${response.statusText} - ${text}`);
                }

                const json = await response.json();
                allData.push(...json.data);
                if (json.included) includedMap.push(...json.included);

                nextUrl = json.links && json.links.next ? json.links.next : null;
            }
            return { data: allData, included: includedMap };
        };

        // 1. All published jobs — includes public, hidden, and unlisted (1:1 with ATS dashboard)
        const publishedUrl = `${this.baseUrl}/jobs?filter[status]=published`;
        
        // 2. Internal Feed Jobs (The secret "internal" jobs)
        const internalUrl = `${this.baseUrl}/jobs?filter[feed]=internal`;

        console.log("Fetching Published and Internal jobs...");
        
        try {
            const [publishedRes, internalRes] = await Promise.all([
                fetchAllPages(publishedUrl),
                fetchAllPages(internalUrl)
            ]);

            // Merge Data
            const allJobs = [...publishedRes.data, ...internalRes.data];
            const allIncluded = [...publishedRes.included, ...internalRes.included];

            // Deduplicate by ID
            const uniqueJobsMap = new Map();
            allJobs.forEach(job => uniqueJobsMap.set(job.id, job));
            const uniqueJobs = Array.from(uniqueJobsMap.values());

            console.log(`Fetched: ${publishedRes.data.length} published + ${internalRes.data.length} internal. Total Unique: ${uniqueJobs.length}`);

            return { data: uniqueJobs, included: allIncluded };

        } catch (error) {
            console.error("Error fetching jobs:", error);
            throw error;
        }
    }

    // --- WRITE OPERATIONS ---

    async uploadFile(file) {
        // Teamtailor requires a FormData upload to /files
        // The file argument is expected to be a File object or similar (from Request.formData())
        const url = `${this.baseUrl}/files`;
        
        // Note: For file upload, we might need to let the browser/worker set the Content-Type header with usage of FormData
        // So we override getHeaders to NOT set Content-Type
        const headers = {
            'Authorization': `Token token=${this.writeApiKey}`,
            'X-Api-Version': this.apiVersion
            // Content-Type is automatic with FormData
        };

        const formData = new FormData();
        formData.append('file', file, file.name);

        console.log(`[TeamTailor] Uploading file: ${file.name}`);
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: formData
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`TeamTailor Upload Error: ${response.status} ${text}`);
        }

        /* Response format:
           {
             "data": {
               "type": "files",
               "id": "...",
               "attributes": {
                 "uri": "https://..."
               }
             }
           }
        */
        const json = await response.json();
        console.log("[TeamTailor] Upload Response:", JSON.stringify(json));
        
        // Handle flat response format (observed in logs)
        if (json.uri) {
            return json.uri;
        }

        // Handle standard JSON:API response format (fallback)
        if (json.data && json.data.attributes && json.data.attributes.uri) {
            return json.data.attributes.uri;
        }

        throw new Error("Invalid Upload Response: 'uri' property missing. Response: " + JSON.stringify(json));
    }

    async createCandidate(payload) {
        const url = `${this.baseUrl}/candidates`;
        const headers = await this.getHeaders(true);

        /* Payload structure (JSON:API):
           {
             "data": {
               "type": "candidates",
               "attributes": {
                 "first-name": "...",
                 "last-name": "...",
                 "email": "...",
                 "phone": "...",
                 "resume": "URI-from-upload" 
               }
             }
           }
        */

        console.log(`[TeamTailor] Creating Candidate: ${payload.data.attributes.email}`);
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`TeamTailor Create Candidate Error: ${response.status} ${text}`);
        }

        return await response.json();
    }

    async createJobApplication(candidateId, jobId, coverLetter = null) {
        const url = `${this.baseUrl}/job-applications`;
        const headers = await this.getHeaders(true);

        const payload = {
            data: {
                type: "job-applications",
                attributes: {}, // Initialize attributes
                relationships: {
                    candidate: {
                        data: { type: "candidates", id: candidateId }
                    },
                    job: {
                        data: { type: "jobs", id: jobId }
                    }
                }
            }
        };

        if (coverLetter) {
            payload.data.attributes['cover-letter'] = coverLetter;
        }

        console.log(`[TeamTailor] Creating Application: Candidate ${candidateId} -> Job ${jobId}`);
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`TeamTailor Create Application Error: ${response.status} ${text}`);
        }

        return await response.json();
    }

    async createAnswer(candidateId, questionId, attributes) {
        // Attributes depends on question type:
        // Text: { text: "..." }
        // Choice: { choices: [id, id] }
        // Range: { range: 5 }
        // Boolean: { boolean: true/false }
        
        const url = `${this.baseUrl}/answers`;
        const headers = await this.getHeaders(true);

        const payload = {
            data: {
                type: "answers",
                attributes: attributes,
                relationships: {
                    question: {
                        data: { type: "questions", id: questionId }
                    },
                    candidate: {
                        data: { type: "candidates", id: candidateId }
                    }
                }
            }
        };

        console.log(`[TeamTailor] Submitting Answer for Candidate ${candidateId}, Q ${questionId}`, JSON.stringify(attributes));
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`TeamTailor Answer Error: ${response.status} ${text}`);
        }

        return await response.json();
    }

    async getCandidateByEmail(email) {
        // GET /v1/candidates?filter[email]=...
        const url = `${this.baseUrl}/candidates?filter[email]=${encodeURIComponent(email)}`;
        const headers = await this.getHeaders(); // Use Read Key
        
        const response = await fetch(url, { headers });
        if (!response.ok) {
            // If 401/403, might be key issue. If 200 but empty, that's fine.
            const text = await response.text();
            throw new Error(`TeamTailor Search Error: ${response.status} ${text}`);
        }
        
        const json = await response.json();
        if (json.data && json.data.length > 0) {
            return json.data[0].id;
        }
        return null; // Not found
    }

    async updateCandidate(candidateId, payload) {
        // PATCH /v1/candidates/:id
        const url = `${this.baseUrl}/candidates/${candidateId}`;
        const headers = await this.getHeaders(true); // Write Key

        console.log(`[TeamTailor] Updating Candidate: ${candidateId}`);
        const response = await fetch(url, {
            method: 'PATCH',
            headers: headers,
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`TeamTailor Update Candidate Error: ${response.status} ${text}`);
        }

        return await response.json();
    }

    async checkExistingApplication(candidateId, jobId) {
        // GET /v1/candidates/:id/job-applications?include=job
        // We need to list applications for this candidate and check if any match the jobId
        const url = `${this.baseUrl}/candidates/${candidateId}/job-applications?include=job`;
        const headers = await this.getHeaders(); // Read Key is sufficient for listing? Or Write? 
        // Listing usually requires same permissions as searching candidates -> Read Key should work if it has permissions.
        // BUT: User's Read key might be restrictive. Let's try Read first, but might need Write if Read is "public key" (which usually can't list apps).
        // Safest is to use the Write Key (Admin) since we know it works for creating things and usually admin keys have full read access too.
        // Actually, the previous issue was Write key didn't have Read permission on Candidates. 
        // Let's assume the Read key (ZDn7...) is a proper API key with Read permissions.
        
        const response = await fetch(url, { headers });
        if (!response.ok) {
            // gracefully fail checks? or throw?
            const text = await response.text();
            console.warn(`[TeamTailor] Failed to check existing applications: ${response.status} ${text}`);
            return null;
        }

        const json = await response.json();
        const apps = json.data;
        
        // Find application where relationship job.id == jobId
        // Note: usage of 'include=job' is to be safe, but relationship data might be in the primary resource too.
        // JSON:API relationships: data.relationships.job.data.id
        
        const existingApp = apps.find(app => 
            app.relationships && 
            app.relationships.job && 
            app.relationships.job.data && 
            String(app.relationships.job.data.id) === String(jobId)
        );

        if (existingApp) {
            return existingApp.id;
        }
        return null;
    }

    async createUpload(candidateId, fileUri, fileName) {
        // Link a generic file (upload) to a candidate
        const url = `${this.baseUrl}/uploads`;
        const headers = await this.getHeaders(true);

        const payload = {
            data: {
                type: "uploads",
                attributes: {
                    url: fileUri, // The transient URI from uploadFile
                    "file-name": fileName
                },
                relationships: {
                    candidate: {
                        data: { type: "candidates", id: candidateId }
                    }
                }
            }
        };

        console.log(`[TeamTailor] Creating Upload (Attachment) for Candidate ${candidateId}: ${fileName}`);
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`TeamTailor Create Upload Error: ${response.status} ${text}`);
        }

        return await response.json();
    }

    // Helper to resolve included resources
    static getIncludedResource(data, type, id) {
        if (!data.included) return null;
        return data.included.find(item => item.type === type && item.id === id);
    }
}
