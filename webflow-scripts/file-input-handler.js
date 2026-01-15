/**
 * File Input Handler
 * Updates file input labels with selected file names.
 * Works with .file-input-hidden inputs and corresponding label elements.
 */
document.addEventListener('DOMContentLoaded', () => {
  const fileInputs = document.querySelectorAll('.file-input-hidden');

  fileInputs.forEach(input => {
    const labelId = `${input.id}-name`; 
    const labelText = document.getElementById(labelId);
    
    if (!labelText) return;
    const defaultText = labelText.textContent;

    input.addEventListener('change', function() {
      if (this.files && this.files.length > 1) {
        labelText.textContent = `${this.files.length} files selected`;
      } else if (this.files && this.files.length === 1) {
        labelText.textContent = this.files[0].name;
      } else {
        labelText.textContent = defaultText;
      }
    });
  });
});
