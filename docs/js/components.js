
async function loadComponent(containerId, filePath) {
    const container = document.getElementById(containerId);

    if (!container) {
        throw new Error(`Container not found: #${containerId}`);
    }

    const response = await fetch(filePath);

    if (!response.ok) {
        throw new Error(`Failed to load: ${filePath}`);
    }

    container.innerHTML = await response.text();
}

async function initializeApp() {
    try {
        // 1. Load the main application layout
        await loadComponent(
            "app-container",
            "./layout/application.html"
        );

        // 2. Load the main application components
        await Promise.all([
            loadComponent("menubar-container", "./layout/shared/menubar.html"),
            loadComponent("main-workspace-container", "./layout/desktop/main-workspace.html"),
            loadComponent("mobile-menu-container", "./layout/mobile/mobile-menu.html"),
            loadComponent("settings-container", "./layout/shared/settings.html"),
            loadComponent("contact-container", "./layout/shared/contact.html")
        ]);


// 3. Load components inside the main workspace
        await Promise.all([
            loadComponent(
                "mobile-header-container",
                "./layout/mobile/mobile-header.html"
            ),
            loadComponent(
                "news-content-container",
                "./layout/desktop/news-content.html"
            ),
            loadComponent(
                "community-pane-container",
                "./layout/desktop/community-pane.html"
            )
        ]);


        // 4. Initialize the existing application logic
        await import("./app.js");

        console.log("iSheep components loaded successfully.");

    } catch (error) {
        console.error("iSheep initialization failed:", error);
    }
}

initializeApp();
