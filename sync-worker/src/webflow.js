export class WebflowClient {
    constructor(token, collectionId) {
        this.token = token;
        this.collectionId = collectionId;
        this.baseUrl = 'https://api.webflow.com/v2';
    }

    async getHeaders() {
        return {
            'Authorization': `Bearer ${this.token}`,
            'accept-version': '2.0.0',
            'Content-Type': 'application/json'
        };
    }

    async getAllItems() {
        try {
            const url = `${this.baseUrl}/collections/${this.collectionId}/items?limit=100`;
            const headers = await this.getHeaders();
            const response = await fetch(url, { headers });
            
            if (!response.ok) {
                throw new Error(`Webflow List Error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            return data.items;
        } catch (error) {
            console.error('Error fetching all Webflow items:', error);
            throw error;
        }
    }

    async findJobByTeamTailorId(teamTailorId) {
        // ... kept for backward compatibility if needed, or usage by single webhook
        // For single webhook, searching might still be needed if we don't have a cache.
        // Or we can reuse getAllItems but that's inefficient for 1 item if we have search (but WF doesn't have search by field efficiently without CMS API which limits).
        // Actually, for single Webhook, findJobByTeamTailorId is fine (1 req).
        return (await this.getAllItems()).find(item => item.fieldData['job-id'] === String(teamTailorId));
    }

    async createItem(fieldData) {
        const url = `${this.baseUrl}/collections/${this.collectionId}/items`;
        const headers = await this.getHeaders();
        
        const payload = {
            isArchived: false,
            isDraft: false,
            fieldData: fieldData
        };

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Webflow Create Error: ${response.status} - ${errorText}`);
        }

        return await response.json();
    }

    async updateItem(itemId, fieldData, isArchived = false) {
        const url = `${this.baseUrl}/collections/${this.collectionId}/items/${itemId}`;
        const headers = await this.getHeaders();

        const payload = {
            fieldData: fieldData
        };

        if (isArchived) {
            payload.isArchived = true;
        }

        const response = await fetch(url, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Webflow Update Error: ${response.status} - ${errorText}`);
        }

        return await response.json();
    }

    async publishItem(itemId) {
        // Publish specific item to make it live
        const url = `${this.baseUrl}/collections/${this.collectionId}/items/publish`;
        const headers = await this.getHeaders();
        
        const payload = {
            itemIds: [itemId]
        };

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Webflow Publish Error for ${itemId}: ${response.status} - ${errorText}`);
            // Don't throw here to avoid failing the whole sync just for publish, 
            // but logging is important.
            // Actually, if publish fails, it's worth knowing.
            throw new Error(`Webflow Publish Error: ${response.status} - ${errorText}`);
        }

        return await response.json();
    }
}
