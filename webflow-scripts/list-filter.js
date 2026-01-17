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

  const filterList = () => {
    const locVal = locationSelect.value;
    const remoteVal = remoteSelect.value;

    listItems.forEach(item => {
      const data = getCleanData(item);
      const matchLoc = !locVal || data.locations.includes(locVal);
      const matchRemote = !remoteVal || data.remote === remoteVal;
      item.style.display = matchLoc && matchRemote ? "block" : "none";
    });
  };

  locationSelect.addEventListener("change", filterList);
  remoteSelect.addEventListener("change", filterList);
});
