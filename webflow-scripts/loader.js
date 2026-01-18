/**
 * Webflow Script Loader
 * 
 * Instructions:
 * 1. Add this script to your Webflow project (Header or Footer code).
 * 2. Use `loadWebflowScript('your-script-name.js')` to load other scripts.
 * 3. Set `localStorage.setItem('devenv', 'true')` in your browser console to enable Dev Mode (loads from localhost).
 * 4. Remove the item to switch back to Production (jsDelivr).
 */

(function() {
    const DEV_BASE_URL = 'http://localhost:8080/webflow-scripts/';
    const PROD_BASE_URL = 'https://cdn.jsdelivr.net/gh/reQruitz-K/teamtailor-bridge@main/webflow-scripts/';

    window.loadWebflowScript = function(scriptName) {
        const isDev = localStorage.getItem('devenv') === 'true';
        const baseUrl = isDev ? DEV_BASE_URL : PROD_BASE_URL;
        const scriptUrl = baseUrl + scriptName;

        const script = document.createElement('script');
        script.src = scriptUrl;
        script.async = true;
        
        script.onload = () => {
             console.log(`[ScriptLoader] Loaded ${scriptName} from ${isDev ? 'DEV' : 'PROD'}`);
             // Dispatch event in case other scripts depend on it
             document.dispatchEvent(new CustomEvent('ScriptLoaded', { detail: { name: scriptName } }));
        };

        script.onerror = () => {
            console.error(`[ScriptLoader] Failed to load ${scriptName} from ${isDev ? 'DEV' : 'PROD'}`);
        };

        document.body.appendChild(script);
    };

    // Auto-load scripts if defined in a global config (optional)
    if (window.WEBFLOW_SCRIPTS) {
        window.WEBFLOW_SCRIPTS.forEach(script => window.loadWebflowScript(script));
    }
})();
