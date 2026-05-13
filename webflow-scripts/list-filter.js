document.addEventListener("DOMContentLoaded", () => {
  const listItems = Array.from(document.querySelectorAll(".w-dyn-item"));
  const locationSelect = document.getElementById("locations");
  const remoteSelect = document.getElementById("remote");


  const getCleanData = (item) => {
    const rawLoc = item.querySelector("[data-location-label]")?.textContent || "";
    const cleanLoc = rawLoc.trim().replace(/-$/, "").trim();
    const locations = cleanLoc.split(",").map(loc => loc.trim()).filter(Boolean);
    const remoteEl = Array.from(item.querySelectorAll("[data-remote], [data-remote-label]")).find(el => !el.classList.contains("w-condition-invisible"));
    
    return {
      locations: locations,
      remote: remoteEl ? remoteEl.textContent.trim() : ""
    };
  };

  // Pre-process data to avoid repeating DOM reads
  const itemData = listItems.map(item => ({
    element: item,
    data: getCleanData(item)
  }));

  const getUniqueValues = (items, key) => {
    let values = [];
    if (key === 'locations') {
      values = items.flatMap(item => item.data.locations);
    } else if (key === 'remote') {
      values = items.map(item => item.data.remote).filter(Boolean);
    }
    return [...new Set(values)].sort();
  };

  const updateSelectOptions = (select, availableValues) => {
    const currentValue = select.value;
    // Clear existing options except the first one (usually "All" placeholder)
    // Assuming the first option is the "All" / default option
    const defaultOption = select.options[0];
    select.innerHTML = '';
    if (defaultOption) select.appendChild(defaultOption);

    availableValues.forEach(val => {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = val;
      select.appendChild(opt);
    });

    // Restore selection if valid, otherwise reset
    if (currentValue && availableValues.includes(currentValue)) {
      select.value = currentValue;
    } else {
      select.value = defaultOption ? defaultOption.value : "";
    }
  };

  const render = () => {
    const locVal = locationSelect.value;
    const remoteVal = remoteSelect.value;

    // 1. Filter items based on specific OTHER filters to determine available options for EACH filter
    // For Location Options: what's available given the CURRENT Remote selection?
    const validForLocation = itemData.filter(item => !remoteVal || item.data.remote === remoteVal);
    const availableLocations = getUniqueValues(validForLocation, 'locations');

    // For Remote Options: what's available given the CURRENT Location selection?
    const validForRemote = itemData.filter(item => {
      if (!locVal) return true;
      return item.data.locations.includes(locVal);
    });
    const availableRemotes = getUniqueValues(validForRemote, 'remote');

    // Update Dropdowns
    // Note: We need to be careful not to blow away the current selection if it's still valid.
    // However, if the user changes Remote to something incompatible with current Location, Location should probably reset or show empty? 
    // The requirement says "user never sees 'empty state'".
    // This implies we should update the options. 
    // We defer option updating to AFTER we calculate everything to avoid reading the changing DOM value mid-calculation, 
    // BUT we already read `locVal` and `remoteVal` at the top.
    
    // We shouldn't update the options of the dropdown that triggered the change? 
    // No, standard dependent dropdowns usually update the *other* dropdowns.
    // If I change Location, I want to see valid Remotes.
    // If I change Remote, I want to see valid Locations.
    // If I change nothing (init), I want to see all valid Locations and Remotes.

    // Let's update both, but we must ensure we don't annoyingly reset the active one if the user is interacting with it.
    // Actually, usually you update the *dependent* filters. But here they are mutually dependent.
    // A simple approach is to always update the allowed set.
    
    // We need to check if the current value is still in the new set. 
    // `updateSelectOptions` handles this logic.

    // OPTIMIZATION: Only update if the allowed set effectively changes? 
    // For simplicity / robustness, we just run update.
    
    // IMPORTANT: If I am currently selecting "London", and I change Remote to a value where "London" doesn't exist, 
    // "London" will be deselected by `updateSelectOptions`. This is correct behavior to avoid empty state.

    // CAUTION: If we update the options of the element we are currently interacting with, some browsers might behave oddly on `change`.
    // But since `change` fires after selection, it should be fine.
    
    updateSelectOptions(locationSelect, availableLocations);
    updateSelectOptions(remoteSelect, availableRemotes);

    // 2. Get the FINAL filtered list for display (Union of all filters)
    const finalFilteredItems = itemData.filter(item => {
      const matchLoc = !locationSelect.value || item.data.locations.includes(locationSelect.value); // Read fresh value in case it was reset
      const matchRemote = !remoteSelect.value || item.data.remote === remoteSelect.value;
      return matchLoc && matchRemote;
    });

    // Show/hide items based on filter
    itemData.forEach(item => item.element.style.display = "none");
    finalFilteredItems.forEach(item => item.element.style.display = "block");
  };

  // Initial render (populates options based on full list)
  render();

  // Event Listeners
  locationSelect.addEventListener("change", render);
  remoteSelect.addEventListener("change", render);
});
