import assert from "node:assert/strict";
import {
  createWorkflowRuntime,
  executeWorkflowTestCase,
  hasWorkflowDefinition,
} from "../../agent/workflow-actions.mjs";

class FakeLocator {
  constructor(page, selector) {
    this.page = page;
    this.selector = selector;
  }

  first() {
    return this;
  }

  async count() {
    if (this.selector === "body") {
      return 1;
    }
    return this.page.hasElement(this.selector) ? 1 : 0;
  }

  async isVisible() {
    if (this.selector === "body") {
      return true;
    }
    return this.page.hasElement(this.selector);
  }

  async click() {
    await this.page.click(this.selector);
  }

  async fill(value) {
    this.page.fills.set(this.selector, String(value ?? ""));
    // Trigger any onFill handler registered for this element
    const element = this.page.elementMap().get(this.selector);
    if (element?.onFill) {
      element.onFill(String(value ?? ""));
    }
  }

  async innerText() {
    if (this.selector === "body") {
      return this.page.bodyText();
    }
    return this.page.getText(this.selector);
  }
}

class FakePage {
  constructor() {
    this.currentUrl = "https://example.com/app";
    this.sceneName = "dashboard";
    this.fills = new Map();
    this.savedEntities = [];
    this.deletedEntities = [];
    this.gotoHistory = [];
    this.selectedColor = "";
    this.selectedIcon = "";

    this.routes = new Map([
      ["https://example.com/app/collections", "collections"],
      ["https://example.com/app/training-planner", "training"],
      ["https://example.com/app/nutrition-plan", "nutrition"],
      ["https://example.com/app/dashboard", "dashboard"],
      ["https://example.com/app/directory", "directory"],
      ["https://example.com/app/athlete-360", "athlete-360"],
      ["https://example.com/app/rank-up-calculator", "rank-calculator"],
    ]);
    this.keyboard = {
      pressHistory: [],
      press: async (key) => {
        this.keyboard.pressHistory.push(key);
        // Simulate Enter triggering search results in directory
        if (key === "Enter" && this.sceneName === "directory-search-filled") {
          this.sceneName = "directory-search-results";
        }
      },
    };
  }

  bodyText() {
    if (this.sceneName === "collection-created") {
      const entity = this.savedEntities.find((item) => item.type === "collection");
      return entity ? `Collections ${entity.name} saved successfully` : "Collections";
    }
    if (this.sceneName === "training-created") {
      const entity = this.savedEntities.find((item) => item.type === "training_plan");
      return entity ? `Training Planner ${entity.name} saved successfully` : "Training Planner";
    }
    if (this.sceneName === "collection-list") {
      return `Collections ${this.savedEntities.map((item) => item.name).join(" ")} ${this.deletedEntities.join(" ")}`;
    }
    if (this.sceneName === "dashboard") {
      return "Dashboard | Athletes: 42 | Competitions: 8 | Recent Activity: Training session completed | Upcoming: National Championship";
    }
    if (this.sceneName === "dashboard-empty") {
      return "";
    }
    if (this.sceneName === "directory") {
      return "Directory Athletes Search";
    }
    if (this.sceneName === "directory-search-filled") {
      return "Directory Athletes Search";
    }
    if (this.sceneName === "directory-search-results") {
      return "Directory Athletes Search Results: John Smith Maria Garcia Carlos Lopez";
    }
    if (this.sceneName === "directory-no-search") {
      return "Directory overview page without any search functionality";
    }
    if (this.sceneName === "athlete-360") {
      return "Athlete 360 Overview John Smith Maria Garcia";
    }
    if (this.sceneName === "athlete-detail") {
      return "John Smith | Speed: 9.2 | Strength: 8.8 | Technical Rating: 87 | Mental Rating: 82";
    }
    if (this.sceneName === "rank-calculator") {
      return "Rank-Up Calculator Enter your metrics below";
    }
    if (this.sceneName === "rank-calculator-result") {
      return "Rank-Up Calculator Result: Your projected rank is Gold III based on current performance metrics";
    }
    return "Dashboard";
  }

  titleText() {
    switch (this.sceneName) {
      case "collections":
      case "collection-form":
      case "collection-created":
      case "collection-list":
        return "Collections";
      case "training":
      case "training-form":
      case "training-created":
        return "Training Planner";
      case "nutrition":
        return "Nutrition Plan";
      case "dashboard":
      case "dashboard-empty":
        return "Dashboard";
      case "directory":
      case "directory-search-filled":
      case "directory-search-results":
      case "directory-no-search":
        return "Directory";
      case "athlete-360":
      case "athlete-detail":
        return "Athlete 360°";
      case "rank-calculator":
      case "rank-calculator-result":
        return "Rank-Up Calculator";
      default:
        return "Dashboard";
    }
  }

  url() {
    return this.currentUrl;
  }

  async title() {
    return this.titleText();
  }

  hasElement(selector) {
    return this.elementMap().has(selector);
  }

  getText(selector) {
    return this.elementMap().get(selector)?.text || "";
  }

  locator(selector) {
    return new FakeLocator(this, selector);
  }

  async goto(url) {
    this.gotoHistory.push(url);
    const scene = this.routes.get(url);
    if (scene) {
      this.sceneName = scene;
      this.currentUrl = url;
    }
    return { status: () => 200 };
  }

  // Simulate a click on an athlete card navigating to detail
  navigateToAthleteDetail() {
    this.sceneName = "athlete-detail";
    this.currentUrl = "https://example.com/app/athlete-360/john-smith";
  }

  // Simulate calculation producing output
  runCalculation() {
    this.sceneName = "rank-calculator-result";
  }

  async waitForLoadState() {}

  async reload() {
    if (this.sceneName === "collection-created") {
      this.sceneName = "collection-created";
      return { status: () => 200 };
    }
    if (this.sceneName === "training-created") {
      this.sceneName = "training-created";
      return { status: () => 200 };
    }
    return { status: () => 200 };
  }

  elementMap() {
    const map = new Map();
    switch (this.sceneName) {
      case "collections":
        map.set('button:has-text("Create Collection")', { onClick: () => this.openCollectionForm() });
        map.set('[role="button"]:has-text("Create Collection")', { onClick: () => this.openCollectionForm() });
        break;
      case "collection-form":
        map.set('input[placeholder*="Collection name" i]', {});
        map.set('textarea[placeholder*="Add a description" i]', {});
        map.set('[data-color="blue"]', { onClick: () => { this.selectedColor = "blue"; } });
        map.set('[data-icon="folder"]', { onClick: () => { this.selectedIcon = "folder"; } });
        map.set('button:has-text("Create Collection")', { onClick: () => this.saveEntity("collection") });
        map.set('[role="button"]:has-text("Create Collection")', { onClick: () => this.saveEntity("collection") });
        break;
      case "collection-created":
        map.set('text="Delete Collection"', { onClick: () => this.sceneName = "collection-delete-confirm" });
        map.set('button:has-text("Delete Collection")', { onClick: () => this.sceneName = "collection-delete-confirm" });
        map.set('[role="button"]:has-text("Delete Collection")', { onClick: () => this.sceneName = "collection-delete-confirm" });
        map.set(`text="${this.savedEntities.find((item) => item.type === "collection")?.name || ""}"`, {});
        break;
      case "collection-delete-confirm":
        map.set('button:has-text("Confirm")', { onClick: () => this.deleteLatest("collection") });
        map.set('[role="button"]:has-text("Confirm")', { onClick: () => this.deleteLatest("collection") });
        break;
      case "training":
        map.set('button:has-text("Create Training Plan")', { onClick: () => this.openTrainingForm() });
        map.set('[role="button"]:has-text("Create Training Plan")', { onClick: () => this.openTrainingForm() });
        break;
      case "training-form":
        map.set('input[name="name"]', {});
        map.set('textarea[name="description"]', {});
        map.set('button:has-text("Save Training Plan")', { onClick: () => this.saveEntity("training_plan") });
        map.set('[role="button"]:has-text("Save Training Plan")', { onClick: () => this.saveEntity("training_plan") });
        break;
      case "training-created":
        map.set(`text="${this.savedEntities.find((item) => item.type === "training_plan")?.name || ""}"`, {});
        break;
      case "directory":
        map.set('input[type="search"]', {
          onClick: () => {},
          onFill: (v) => {
            this.sceneName = "directory-search-filled";
          },
        });
        break;
      case "directory-search-filled":
        map.set('input[type="search"]', {});
        break;
      case "directory-search-results":
        map.set('input[type="search"]', {});
        break;
      case "athlete-360":
        map.set('[class*="card"]:first-child', {
          onClick: () => this.navigateToAthleteDetail(),
        });
        map.set('[class*="athlete-card"]', {
          onClick: () => this.navigateToAthleteDetail(),
        });
        break;
      case "rank-calculator":
        map.set('input[type="number"]', {});
        map.set('button:has-text("Calculate")', {
          onClick: () => this.runCalculation(),
        });
        break;
      default:
        break;
    }
    return map;
  }

  openCollectionForm() {
    this.sceneName = "collection-form";
    this.currentUrl = "https://example.com/app/collections/new";
  }

  openTrainingForm() {
    this.sceneName = "training-form";
    this.currentUrl = "https://example.com/app/training-planner/new";
  }

  saveEntity(type) {
    const name =
      this.fills.get('input[name="name"]') ||
      this.fills.get('input[placeholder*="Collection name" i]') ||
      "";
    const description =
      this.fills.get('textarea[name="description"]') ||
      this.fills.get('textarea[placeholder*="Add a description" i]') ||
      "";
    this.savedEntities.push({ type, name, description, color: this.selectedColor, icon: this.selectedIcon });
    this.sceneName = type === "collection" ? "collection-created" : "training-created";
    this.currentUrl = type === "collection"
      ? "https://example.com/app/collections/123"
      : "https://example.com/app/training-planner/456";
  }

  deleteLatest(type) {
    const latest = [...this.savedEntities].reverse().find((item) => item.type === type);
    if (latest?.name) {
      this.deletedEntities.push(latest.name);
    }
    this.sceneName = "collection-list";
    this.currentUrl = "https://example.com/app/collections";
  }

  async click(selector) {
    const element = this.elementMap().get(selector);
    if (element?.onClick) {
      element.onClick();
    }
  }
}

const websiteBrief = {
  url: "https://example.com/app",
  pages: [
    { title: "Collections", url: "https://example.com/app/collections" },
    { title: "Training Planner", url: "https://example.com/app/training-planner" },
    { title: "Nutrition Plan", url: "https://example.com/app/nutrition-plan" },
    { title: "Dashboard", url: "https://example.com/app/dashboard" },
    { title: "Directory", url: "https://example.com/app/directory" },
    { title: "Athlete 360°", url: "https://example.com/app/athlete-360" },
    { title: "Rank-Up Calculator", url: "https://example.com/app/rank-up-calculator" },
  ],
};

const cases = [
  {
    name: "hasWorkflowDefinition detects structured workflow metadata",
    run() {
      assert.equal(hasWorkflowDefinition({ title: "Legacy case" }), false);
      assert.equal(
        hasWorkflowDefinition({
          setupActions: [{ type: "create_collection" }],
        }),
        true
      );
      assert.equal(
        hasWorkflowDefinition({
          action: { type: "create_training_plan" },
        }),
        true
      );
    },
  },
  {
    name: "executeWorkflowTestCase can create and clean up a collection",
    async run() {
      const page = new FakePage();
      const runtime = createWorkflowRuntime({ id: "TC-WF-001" });
      const result = await executeWorkflowTestCase(
        page,
        websiteBrief,
        {
          id: "TC-WF-001",
          action: {
            type: "create_collection",
            module: "Collections",
            color: "blue",
            icon: "folder",
            locators: {
              createButton: 'button:has-text("Create Collection")',
              nameInput: 'input[placeholder*="Collection name" i]',
              descriptionInput: 'textarea[placeholder*="Add a description" i]',
              colorOption: '[data-color="blue"]',
              iconOption: '[data-icon="folder"]',
              submitButton: 'button:has-text("Create Collection")',
            },
          },
          assertions: [
            { type: "created_entity_visible", entityType: "collection" },
            { type: "refresh_and_created_entity_visible", entityType: "collection" },
          ],
          cleanupActions: [
            {
              type: "delete_collection",
              module: "Collections",
              locators: {
                deleteButton: 'button:has-text("Delete Collection")',
                confirmDeleteButton: 'button:has-text("Confirm")',
              },
            },
          ],
        },
        runtime
      );

      assert.equal(result.runtime.createdEntities.length, 1);
      assert.equal(result.runtime.deletedEntities.length, 1);
      assert.equal(result.runtime.createdEntities[0].type, "collection");
      assert.match(result.runtime.createdEntities[0].name, /^Codex Collection /);
      assert.equal(result.runtime.createdEntities[0].color, "blue");
      assert.equal(result.runtime.createdEntities[0].icon, "folder");
      assert.equal(page.deletedEntities.length, 1);
      assert.equal(page.selectedColor, "blue");
      assert.equal(page.selectedIcon, "folder");
    },
  },
  {
    name: "executeWorkflowTestCase can create a training plan with explicit data",
    async run() {
      const page = new FakePage();
      const runtime = createWorkflowRuntime({ id: "TC-WF-002" });
      const result = await executeWorkflowTestCase(
        page,
        websiteBrief,
        {
          id: "TC-WF-002",
          action: {
            type: "create_training_plan",
            module: "Training Planner",
            name: "Codex Training Plan Alpha",
            description: "Automation-created training plan",
            locators: {
              createButton: 'button:has-text("Create Training Plan")',
              nameInput: 'input[name="name"]',
              descriptionInput: 'textarea[name="description"]',
              submitButton: 'button:has-text("Save Training Plan")',
            },
          },
          assertions: [
            { type: "text_visible", text: "Codex Training Plan Alpha" },
            { type: "url_includes", value: "/training-planner/" },
          ],
        },
        runtime
      );

      assert.equal(result.runtime.createdEntities.length, 1);
      assert.equal(result.runtime.createdEntities[0].name, "Codex Training Plan Alpha");
      assert.equal(result.runtime.cleanupErrors.length, 0);
    },
  },

  // ---------------------------------------------------------------------------
  // verify_module_content tests
  // ---------------------------------------------------------------------------
  {
    name: "verify_module_content passes when module body has substantive content",
    async run() {
      const page = new FakePage();
      const runtime = createWorkflowRuntime({ id: "TC-VMC-001" });
      const result = await executeWorkflowTestCase(
        page,
        websiteBrief,
        {
          id: "TC-VMC-001",
          action: {
            type: "verify_module_content",
            module: "Dashboard",
            route: "https://example.com/app/dashboard",
            minBodyChars: 50,
          },
          assertions: [],
        },
        runtime
      );
      assert.ok(result, "Expected a result");
      assert.ok(result.actionResult?.bodyLength > 50, "Expected body length > 50");
    },
  },
  {
    name: "verify_module_content fails when module body is too short",
    async run() {
      const page = new FakePage();
      page.sceneName = "dashboard-empty"; // overrides to empty body
      // Override goto so it stays on dashboard-empty
      page.routes.set("https://example.com/app/dashboard", "dashboard-empty");
      const runtime = createWorkflowRuntime({ id: "TC-VMC-002" });
      await assert.rejects(
        () =>
          executeWorkflowTestCase(
            page,
            websiteBrief,
            {
              id: "TC-VMC-002",
              action: {
                type: "verify_module_content",
                module: "Dashboard",
                route: "https://example.com/app/dashboard",
                minBodyChars: 50,
              },
            },
            runtime
          ),
        /Dashboard module loaded but shows insufficient content/
      );
    },
  },

  // ---------------------------------------------------------------------------
  // search_in_directory tests
  // ---------------------------------------------------------------------------
  {
    name: "search_in_directory passes when search fills and results appear",
    async run() {
      const page = new FakePage();
      const runtime = createWorkflowRuntime({ id: "TC-SID-001" });
      const result = await executeWorkflowTestCase(
        page,
        websiteBrief,
        {
          id: "TC-SID-001",
          action: {
            type: "search_in_directory",
            module: "Directory",
            route: "https://example.com/app/directory",
            query: "John",
          },
          assertions: [],
        },
        runtime
      );
      assert.ok(result, "Expected a result");
      assert.ok(
        page.keyboard.pressHistory.includes("Enter"),
        "Expected Enter key to be pressed for search"
      );
    },
  },
  {
    name: "search_in_directory fails when no search input exists",
    async run() {
      const page = new FakePage();
      // Use a scene with no search input
      page.sceneName = "directory-no-search";
      page.routes.set("https://example.com/app/directory", "directory-no-search");
      const runtime = createWorkflowRuntime({ id: "TC-SID-002" });
      await assert.rejects(
        () =>
          executeWorkflowTestCase(
            page,
            websiteBrief,
            {
              id: "TC-SID-002",
              action: {
                type: "search_in_directory",
                module: "Directory",
                route: "https://example.com/app/directory",
                query: "a",
              },
            },
            runtime
          ),
        /Could not find a search input/
      );
    },
  },

  // ---------------------------------------------------------------------------
  // open_first_athlete tests
  // ---------------------------------------------------------------------------
  {
    name: "open_first_athlete passes when athlete card click navigates to detail",
    async run() {
      const page = new FakePage();
      const runtime = createWorkflowRuntime({ id: "TC-OFA-001" });
      const result = await executeWorkflowTestCase(
        page,
        websiteBrief,
        {
          id: "TC-OFA-001",
          action: {
            type: "open_first_athlete",
            module: "Athlete 360°",
            route: "https://example.com/app/athlete-360",
          },
          assertions: [],
        },
        runtime
      );
      assert.ok(result, "Expected a result");
      assert.match(
        page.currentUrl,
        /athlete/,
        "Expected URL to change to athlete detail"
      );
    },
  },
  {
    name: "open_first_athlete fails when no athlete cards are found",
    async run() {
      const page = new FakePage();
      // Use dashboard scene which has no athlete cards
      page.routes.set("https://example.com/app/athlete-360", "dashboard");
      const runtime = createWorkflowRuntime({ id: "TC-OFA-002" });
      await assert.rejects(
        () =>
          executeWorkflowTestCase(
            page,
            websiteBrief,
            {
              id: "TC-OFA-002",
              action: {
                type: "open_first_athlete",
                module: "Athlete 360°",
                route: "https://example.com/app/athlete-360",
              },
            },
            runtime
          ),
        /No athlete cards or list items found/
      );
    },
  },

  // ---------------------------------------------------------------------------
  // run_rank_calculator tests
  // ---------------------------------------------------------------------------
  {
    name: "run_rank_calculator passes when inputs fill and calculate triggers",
    async run() {
      const page = new FakePage();
      const runtime = createWorkflowRuntime({ id: "TC-RRC-001" });
      const result = await executeWorkflowTestCase(
        page,
        websiteBrief,
        {
          id: "TC-RRC-001",
          action: {
            type: "run_rank_calculator",
            module: "Rank-Up Calculator",
            route: "https://example.com/app/rank-up-calculator",
          },
          assertions: [],
        },
        runtime
      );
      assert.ok(result, "Expected a result");
      assert.equal(page.sceneName, "rank-calculator-result", "Expected calculation to run");
    },
  },
  {
    name: "run_rank_calculator fails when no numeric inputs are available",
    async run() {
      const page = new FakePage();
      // Use dashboard scene which has no calculator inputs
      page.routes.set("https://example.com/app/rank-up-calculator", "dashboard");
      const runtime = createWorkflowRuntime({ id: "TC-RRC-002" });
      await assert.rejects(
        () =>
          executeWorkflowTestCase(
            page,
            websiteBrief,
            {
              id: "TC-RRC-002",
              action: {
                type: "run_rank_calculator",
                module: "Rank-Up Calculator",
                route: "https://example.com/app/rank-up-calculator",
              },
            },
            runtime
          ),
        /Could not find any calculator input fields/
      );
    },
  },
];

let failures = 0;

for (const entry of cases) {
  try {
    await entry.run();
    console.log(`PASS ${entry.name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${entry.name}`);
    console.error(error?.stack || error?.message || String(error));
  }
}

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log(`PASS ${cases.length} tests`);
}
