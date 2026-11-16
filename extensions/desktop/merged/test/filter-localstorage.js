const data = require('./tcf_detection_test_results.json');

const localStorageOnlyCases = data.failedCases.filter(entry => {
  const locations = entry.storage_locations;

  // Must have at least one storage location
  if (!locations || locations.length === 0) {
    return false;
  }

  // Every storage location must be LocalStorage
  return locations.every(loc => loc.location === 'LocalStorage');
});

console.log('Count:', localStorageOnlyCases.length);
console.log(
  'Websites:',
  localStorageOnlyCases.map(entry => entry.website)
);
