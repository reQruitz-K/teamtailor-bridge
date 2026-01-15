/**
 * Dynamic Questions Renderer
 * Renders dynamic form questions (Choice/Radio, Range/Slider, Textarea)
 * from JSON data embedded in #job-questions-data element.
 */
(function() {
    try {
        const dataEl = document.getElementById('job-questions-data');
        const container = document.getElementById('dynamic-questions-container');
        
        const rawData = dataEl.textContent.trim();
        
        // Helper to remove elements
        const removeElements = () => {
            if (dataEl) dataEl.remove();
            if (container) container.remove();
        };
        if (!rawData) {
            removeElements();
            return;
        }
        
        const questions = JSON.parse(rawData);
        
        if (!questions || questions.length === 0) {
            removeElements();
            return;
        }
        container.innerHTML = '';
        questions.forEach(q => {
            const wrapper = document.createElement('div');
            wrapper.className = 'question-wrapper';
            // Question Label
            const label = document.createElement('label');
            label.className = 'form_field-label'; // Updated class
            label.innerText = q.label + (q.required ? ' *' : '');
            wrapper.appendChild(label);
            let inputContainer;
            // --- RENDER LOGIC ---
            if (q.type === 'Choice' || q.type === 'select') {
                // RADIO BUTTONS (Pills)
                inputContainer = document.createElement('div');
                inputContainer.className = 'radio-group';
                (q.options || []).forEach(opt => {
                    const optLabel = document.createElement('label');
                    optLabel.className = 'radio-pill w-radio'; 
                    const radioInput = document.createElement('input');
                    radioInput.type = 'radio';
                    radioInput.name = `question_${q.id}`; 
                    radioInput.value = opt.title || opt.label;
                    radioInput.className = 'w-radio-input'; 
                    if (q.required) radioInput.required = true;
                    const textSpan = document.createElement('span');
                    textSpan.className = 'w-form-label';
                    textSpan.innerText = opt.title || opt.label;
                    optLabel.appendChild(radioInput);
                    optLabel.appendChild(textSpan);
                    inputContainer.appendChild(optLabel);
                });
            } else if (q.type === 'Range') {
                // SLIDER UI
                inputContainer = document.createElement('div');
                inputContainer.className = 'slider-container';
                
                const min = q.config?.min || 0;
                const max = q.config?.max || 10;
                const unit = q.config?.unit || 'Years';
                
                // Value Display
                const valDisplay = document.createElement('span');
                valDisplay.className = 'slider-value-display';
                valDisplay.innerText = min; 
                
                const unitDisplay = document.createElement('span');
                unitDisplay.className = 'slider-unit-display';
                unitDisplay.innerText = unit;
                // Input Range
                const rangeInput = document.createElement('input');
                rangeInput.type = 'range';
                rangeInput.className = 'custom-range'; // Custom slider class
                rangeInput.name = `question_${q.id}`;
                rangeInput.min = min;
                rangeInput.max = max;
                rangeInput.value = min; 
                if (q.required) rangeInput.required = true;
                // Update Event
                rangeInput.addEventListener('input', (e) => {
                    valDisplay.innerText = e.target.value;
                });
                inputContainer.appendChild(valDisplay);
                inputContainer.appendChild(unitDisplay);
                inputContainer.appendChild(rangeInput);
            } else {
                // FALLBACK TEXTAREA
                inputContainer = document.createElement('textarea');
                inputContainer.className = 'form_input is-new w-input'; // Updated
                inputContainer.style.borderRadius = '8px';
                inputContainer.style.padding = '12px';
                inputContainer.name = `question_${q.id}`;
                if (q.required) inputContainer.required = true;
                inputContainer.placeholder = "Type your answer here...";
                inputContainer.rows = 4;
            }
            wrapper.appendChild(inputContainer);
            container.appendChild(wrapper);
        });
    } catch (e) {
        console.error("Dynamic form error:", e);
    }
})();
