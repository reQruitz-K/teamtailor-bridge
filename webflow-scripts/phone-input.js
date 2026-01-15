/**
 * Enhanced Phone Input
 * Uses intl-tel-input library to provide flag dropdown, search, and formatting.
 * 
 * SETUP IN WEBFLOW:
 * 1. Add "ID" = "phone" to your Phone input field.
 * 2. Add these scripts/styles to <head> or before </body>:
 *    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/intl-tel-input@23.0.1/build/css/intlTelInput.css">
 *    <script src="https://cdn.jsdelivr.net/npm/intl-tel-input@23.0.1/build/js/intlTelInput.min.js"></script>
 */

document.addEventListener('DOMContentLoaded', function() {
    const input = document.querySelector('#phone') || document.querySelector('input[type="tel"]');
    
    if (!input) {
        console.warn("Phone input not found. Make sure ID is 'phone' or type is 'tel'");
        return;
    }

    // 1. Initialize intl-tel-input
    // @ts-ignore
    const iti = window.intlTelInput(input, {
        utilsScript: "https://cdn.jsdelivr.net/npm/intl-tel-input@23.0.1/build/js/utils.js",
        separateDialCode: true, // Shows flag + dial code separately
        initialCountry: "auto",
        geoIpLookup: function(callback) {
            fetch("https://ipapi.co/json")
                .then(function(res) { return res.json(); })
                .then(function(data) { callback(data.country_code); })
                .catch(function() { callback("us"); });
        },
        preferredCountries: [], // No favorites, just alphabetical
    });

    // 2. Ensuring the FULL number is submitted
    // The visual input only contains the local part (e.g. 55 555 55 55)
    // We need to intercept standard submission or ensure the name attribute points 
    // to a hidden input with the full number (+48555555555).

    // Strategy: Rename original input, create hidden input with original name.
    const originalName = input.getAttribute('name') || 'phone';
    
    // Create hidden input
    const hiddenInput = document.createElement('input');
    hiddenInput.type = 'hidden';
    hiddenInput.name = originalName; // This one gets submitted
    input.parentNode.insertBefore(hiddenInput, input);

    // Rename visual input so it doesn't conflict/submit
    input.setAttribute('name', originalName + '_visible');

    // Sync loop
    const updateHiddenInput = () => {
        if (iti.isValidNumber()) {
            hiddenInput.value = iti.getNumber(); // Full International Format
        } else {
            // Fallback: just grab dial code + value
            // hiddenInput.value = iti.getNumber(); 
            // Or if invalid, just pass what we have, but getNumber() usually does best effort.
             hiddenInput.value = iti.getNumber();
        }
        console.log("Phone updated:", hiddenInput.value);
    };

    input.addEventListener('input', updateHiddenInput);
    input.addEventListener('blur', updateHiddenInput);
    input.addEventListener('change', updateHiddenInput);
});
