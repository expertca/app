document.addEventListener('DOMContentLoaded', () => {
    const gridContainer = document.getElementById('tools-grid');
    const searchBar = document.getElementById('search-bar');

    // Function to render the cards based on the provided array
    function renderTools(toolsArray) {
        // Clear the grid first
        gridContainer.innerHTML = '';

        // Handle empty search results
        if (toolsArray.length === 0) {
            gridContainer.innerHTML = `<div class="no-results">No tools found matching your search.</div>`;
            return;
        }

        // Generate the cards
        toolsArray.forEach(tool => {
            const cardLink = document.createElement('a');
            cardLink.href = tool.html;
            cardLink.className = 'tool-card';

            cardLink.innerHTML = `
                <span class="material-icons tool-icon">${tool.icon}</span>
                <div class="tool-text">
                    <h2>${tool.name}</h2>
                    <p>${tool.description}</p>
                </div>
            `;

            gridContainer.appendChild(cardLink);
        });
    }
    if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(err => { console.log('SW registration failed'); }); }); }

    // Initial render of all tools
    renderTools(tools);

    // Real-time search listener
    searchBar.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        
        // Filter the array based on the name or description
        const filteredTools = tools.filter(tool => {
            const nameMatch = tool.name.toLowerCase().includes(searchTerm);
            const descMatch = tool.description.toLowerCase().includes(searchTerm);
            return nameMatch || descMatch;
        });

        // Re-render with the filtered list
        renderTools(filteredTools);
    });
});
