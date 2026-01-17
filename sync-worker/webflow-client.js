/**
 * Webflow Form to Cloudflare Worker Submission Script
 * 
 * Instructions:
 * 1. Add this script to your Webflow project settings or page settings 
 *    in the "Before </body> tag" section.
 * 2. Ensure your Form has ID "email-form" (or update the selector below).
 * 3. Ensure the Hidden Input "job-id" is present in the form.
 * 4. Update the WORKER_URL constant with your deployed Worker URL.
 */

(function() {
    // CONFIGURATION
    const WORKER_URL = 'https://teamtailor-webflow-sync.kasper-kullberg.workers.dev/submit-application';
    const FORM_SELECTOR = '#email-form';
    const SUBMIT_BTN_SELECTOR = 'input[type="submit"], button[type="submit"]';
    
    document.addEventListener('DOMContentLoaded', () => {
        const form = document.querySelector(FORM_SELECTOR);
        
        if (!form) {
            console.warn('[Teamtailor] Form not found: ' + FORM_SELECTOR);
            return;
        }

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const submitBtn = form.querySelector(SUBMIT_BTN_SELECTOR);
            const originalBtnText = submitBtn ? submitBtn.value || submitBtn.innerText : 'Submit';
            
            // 1. UI Loading State
            if (submitBtn) {
                submitBtn.value = 'Sending...';
                submitBtn.innerText = 'Sending...';
                submitBtn.disabled = true;
                submitBtn.style.opacity = '0.7';
                submitBtn.style.cursor = 'wait';
            }

            // 2. Gather Data
            const formData = new FormData(form);
            
            // Debug: Check Job ID
            const jobId = formData.get('job-id');
            if (!jobId) {
                console.error('[Teamtailor] Missing Job ID. Ensure hidden input is present.');
                alert('Configuration Error: Job ID missing. Please contact support.');
                resetBtn();
                return;
            }

            try {
                // 3. Send to Worker
                const response = await fetch(WORKER_URL, {
                    method: 'POST',
                    body: formData
                });
                
                const result = await response.json();

                if (response.ok && result.success) {
                    // 4. Success Handling
                    // Webflow usually hides the form and shows a success message block.
                    // We can mimic this or manually toggle elements.
                    
                    form.style.display = 'none';
                    const successBlock = form.parentElement.querySelector('.w-form-done');
                    const failBlock = form.parentElement.querySelector('.w-form-fail');
                    
                    if (successBlock) {
                        successBlock.style.display = 'block';
                    } else {
                        alert('Application submitted successfully!');
                    }
                    
                    if (failBlock) failBlock.style.display = 'none';

                    console.log('[Teamtailor] Success:', result);
                } else {
                    throw new Error(result.error || 'Submission failed');
                }

            } catch (error) {
                // 5. Error Handling
                console.error('[Teamtailor] Error:', error);
                
                const failBlock = form.parentElement.querySelector('.w-form-fail');
                if (failBlock) {
                    failBlock.style.display = 'block';
                    failBlock.innerText = 'Oops! ' + (error.message || 'Something went wrong. Please try again.');
                } else {
                    alert('Submit Error: ' + error.message);
                }
                
                resetBtn();
            }
            
            function resetBtn() {
                if (submitBtn) {
                    submitBtn.value = originalBtnText;
                    submitBtn.innerText = originalBtnText;
                    submitBtn.disabled = false;
                    submitBtn.style.opacity = '1';
                    submitBtn.style.cursor = 'default';
                }
            }
        });
    });
})();
