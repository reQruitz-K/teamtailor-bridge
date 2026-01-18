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

  const populateLocationSelect = () => {
    const allLocations = listItems.flatMap(item => getCleanData(item).locations);
    const uniqueLocations = [...new Set(allLocations)].sort();
    uniqueLocations.forEach(val => {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = val;
      locationSelect.appendChild(opt);
    });
  };

  const populateRemoteSelect = () => {
    const allRemotes = listItems.map(item => getCleanData(item).remote).filter(Boolean);
    const uniqueRemotes = [...new Set(allRemotes)].sort();
    uniqueRemotes.forEach(val => {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = val;
      remoteSelect.appendChild(opt);
    });
  };

  populateLocationSelect();
  populateRemoteSelect();

  // filterList replaced below


  locationSelect.addEventListener("change", () => {
    visibleCount = 10; // Reset pagination on filter change
    filterList();
  });
  remoteSelect.addEventListener("change", () => {
    visibleCount = 10; // Reset pagination on filter change
    filterList();
  });

  // --- Pagination Logic ---
  let visibleCount = 10;
  const loadMoreBtn = document.querySelector('[data-load]');

  const updatePagination = (visibleItems) => {
    // Hide all first
    visibleItems.forEach(item => item.style.display = 'none');
    
    // Show only up to visibleCount
    const itemsToShow = visibleItems.slice(0, visibleCount);
    itemsToShow.forEach(item => item.style.display = 'block');

    // Handle "Load More" button visibility
    if (loadMoreBtn) {
      if (visibleCount >= visibleItems.length) {
        loadMoreBtn.style.display = 'none';
      } else {
        loadMoreBtn.style.display = 'block'; // Or 'inline-block' depending on design
      }
    }
  };

  const filterList = () => {
    const locVal = locationSelect.value;
    const remoteVal = remoteSelect.value; // Remotes might need similar logic if user wants exact match or just truthy

    // 1. Filter the FULL list first
    const filteredItems = listItems.filter(item => {
      const data = getCleanData(item);
      const matchLoc = !locVal || data.locations.includes(locVal);
      // For remote, exact match or presence? Assuming exact match based on previous code logic
      const matchRemote = !remoteVal || data.remote === remoteVal;
      return matchLoc && matchRemote;
    });

    // 2. Hide items that don't match the filter at all
    listItems.forEach(item => {
      if (!filteredItems.includes(item)) {
        item.style.display = 'none';
      }
    });

    // 3. Apply Pagination to the MATCHING items
    updatePagination(filteredItems);
  };

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', (e) => {
      e.preventDefault();
      visibleCount += 5;
      filterList(); // Re-run filter/pagination display
    });
  }

  // Initial Run
  filterList();
});
