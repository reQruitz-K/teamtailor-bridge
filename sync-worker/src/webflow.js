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
        // Use bulk endpoint so all three locale versions are created in one shot.
        // Items created via the single POST /items endpoint only get a primary-locale
        // record; secondary locale PATCH calls then 404 because those rows never exist.
        const url = `${this.baseUrl}/collections/${this.collectionId}/items/bulk`;
        const headers = await this.getHeaders();

        const payload = {
            isArchived: false,
            isDraft: false,
            fieldData,
            cmsLocaleIds: [
                '662123573a11a37d76a9f412', // EN (primary)
                '665cb20748cb746631bffd66', // FI
                '69b282e8dac0c1bbda31232c'  // SV
            ]
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

        const data = await response.json();
        // Bulk response: { items: [...] } — return the single item we created
        return data.items ? data.items[0] : data;
    }

    async deleteItem(itemId) {
        const url = `${this.baseUrl}/collections/${this.collectionId}/items/${itemId}`;
        const headers = await this.getHeaders();
        const response = await fetch(url, { method: 'DELETE', headers });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Webflow Delete Error: ${response.status} - ${errorText}`);
        }
    }

    async updateItem(itemId, fieldData, isArchived = false) {
        const url = `${this.baseUrl}/collections/${this.collectionId}/items/${itemId}`;
        const headers = await this.getHeaders();

        const payload = {
            isArchived: !!isArchived,
            fieldData: fieldData
        };

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

    async updateItemForLocale(itemId, cmsLocaleId, fieldData) {
        // Individual item PATCH with cmsLocaleId in the body (not as a query param).
        // Per Webflow docs: "Items only update in the primary locale unless cmsLocaleId is in the body."
        const url = `${this.baseUrl}/collections/${this.collectionId}/items/${itemId}`;
        const headers = await this.getHeaders();
        const response = await fetch(url, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ cmsLocaleId, fieldData })
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Webflow Locale Update Error [${cmsLocaleId}]: ${response.status} - ${errorText}`);
        }
        return await response.json();
    }

    async publishItem(itemIds) {
        const url = `${this.baseUrl}/collections/${this.collectionId}/items/publish`;
        const headers = await this.getHeaders();
        const ids = Array.isArray(itemIds) ? itemIds : [itemIds];

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({ itemIds: ids })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Webflow Publish Error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log(`[Webflow] Publish response:`, JSON.stringify(result));
        return result;
    }
}
