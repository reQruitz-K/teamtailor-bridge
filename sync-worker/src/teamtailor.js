export class TeamTailorClient {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.teamtailor.com/v1';
        this.apiVersion = '20210218';
    }

    async getHeaders() {
        return {
            'Authorization': `Token token=${this.apiKey}`,
            'X-Api-Version': this.apiVersion,
            'Content-Type': 'application/vnd.api+json'
        };
    }

    async getJob(jobId) {
        // Fetch single job with all necessary includes
        const include = 'locations,department,role,user';
        const url = `${this.baseUrl}/jobs/${jobId}?include=${include}`;
        
        const headers = await this.getHeaders();
        const response = await fetch(url, { headers });

        if (!response.ok) {
            throw new Error(`TeamTailor Fetch Error: ${response.status} ${response.statusText}`);
        }

        return await response.json();
    }

    async getAllJobs() {
        // Used for the Cron Job reconciliation
        // Fetches all 'active' jobs (published and unlisted)
        const include = 'locations';
        
        const url = new URL(`${this.baseUrl}/jobs`);
        url.searchParams.set('filter[status]', 'published,unlisted');
        url.searchParams.set('include', include);
        url.searchParams.set('page[size]', '30');
        
        const headers = await this.getHeaders();
        const response = await fetch(url.toString(), { headers });

        if (!response.ok) {
            throw new Error(`TeamTailor List Error: ${response.status} ${response.statusText}`);
        }

        return await response.json();
    }

    // Helper to resolve included resources
    static getIncludedResource(data, type, id) {
        if (!data.included) return null;
        return data.included.find(item => item.type === type && item.id === id);
    }
}
