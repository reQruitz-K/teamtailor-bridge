/**
 * Webflow + Teamtailor Dual Submission Script
 * Intercepts form submission, sends to Teamtailor Worker,
 * and handles success/error UI states.
 * 
 * Dependencies: jQuery (comes with Webflow)
 */
document.addEventListener('DOMContentLoaded', function() {
    // 1. Identify the form.
    // Based on your screenshot, the Form Name is "openroles form".
    // Webflow usually adds data-name="openroles form" to the <form> tag.
    const FORM_SELECTOR = 'form[data-name="openroles form"]'; 
    const WORKER_URL = 'https://teamtailor-webflow-sync.kasper-kullberg.workers.dev/submit-application';
    // Fallback: 'form' (first form on page) if the specific one isn't found.
    
    let form = document.querySelector(FORM_SELECTOR);
    if (!form) {
        console.warn("Specific form not found, falling back to first form.");
        form = document.querySelector('form');
    }
    if (!form) return;
    // PREVENT DUPLICATE BINDING
    if (form.getAttribute('data-tt-bound')) {
        console.log("Teamtailor listener already bound. Skipping.");
        return;
    }
    form.setAttribute('data-tt-bound', 'true');
    // Helper: Clone FormData (for logging/debugging if needed)
    // const debugData = (fd) => { for(var pair of fd.entries()) { console.log(pair[0]+ ', '+ pair[1]); } };
    // 1. Check Job Active Status (New Logic)
    // We expect a hidden element with id="job-active-status" containing "true" or "false"
    // Or data-job-active attribute somewhere.
    const activeStatusEl = document.getElementById('job-active-status');
    const isActive = activeStatusEl ? activeStatusEl.textContent.trim().toLowerCase() !== 'false' : true;

    if (!isActive) {
        console.log("Job is inactive. Removing application form.");
        if (form) form.remove(); // OR $(form).remove();
        return;
    }

    // 2. Attach Listener
    // We use jQuery here because Webflow's own scripts heavily rely on jQuery events.
    // Hooking into submit with jQuery ensures we play nice with Webflow's validation.
    
    $(form).submit(async function(e) {
        // Stop Webflow submission COMPLETELY.
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation(); // Prevent other listeners from firing
        const submitBtn = $(this).find('input[type="submit"], .submit-button');
        const originalText = submitBtn.val() || submitBtn.text();
        submitBtn.val('Sending...').text('Sending...');
        submitBtn.prop('disabled', true);
        try {
            // A. Create FormData
            const formData = new FormData(this);
            // B. Send to Teamtailor Worker
            console.log("Sending to Teamtailor...");
            const response = await fetch(WORKER_URL, {
                method: 'POST',
                body: formData
            });
            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Worker Error: ${response.status} ${errText}`);
            }
            
            const json = await response.json();
            console.log("Teamtailor Success:", json);
            // C. Show Success State (Manual)
            // Webflow forms usually have a success div sibling.
            const parent = $(this).parent();
            const successDiv = parent.find('.w-form-done');
            const errorDiv = parent.find('.w-form-fail');
            $(this).hide(); // Hide form
            successDiv.show(); // Show success message
            errorDiv.hide();
        } catch (err) {
            console.error("Submission Failed:", err);
            
            // Show Error State
            const parent = $(this).parent();
            const errorDiv = parent.find('.w-form-fail');
            errorDiv.show();
            
            // Allow retry
            submitBtn.val(originalText).text(originalText);
            submitBtn.prop('disabled', false);
        }
    });
});
