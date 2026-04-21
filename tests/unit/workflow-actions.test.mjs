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

    this.routes = new Map([
      ["https://example.com/app/collections", "collections"],
      ["https://example.com/app/training-planner", "training"],
      ["https://example.com/app/nutrition-plan", "nutrition"],
    ]);
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

  async waitForLoadState() {}

  elementMap() {
    const map = new Map();
    switch (this.sceneName) {
      case "collections":
        map.set('button:has-text("Create Collection")', { onClick: () => this.openCollectionForm() });
        map.set('[role="button"]:has-text("Create Collection")', { onClick: () => this.openCollectionForm() });
        break;
      case "collection-form":
        map.set('input[name="name"]', {});
        map.set('textarea[name="description"]', {});
        map.set('button:has-text("Save Collection")', { onClick: () => this.saveEntity("collection") });
        map.set('[role="button"]:has-text("Save Collection")', { onClick: () => this.saveEntity("collection") });
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
    const name = this.fills.get('input[name="name"]') || "";
    const description = this.fills.get('textarea[name="description"]') || "";
    this.savedEntities.push({ type, name, description });
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
            locators: {
              createButton: 'button:has-text("Create Collection")',
              nameInput: 'input[name="name"]',
              descriptionInput: 'textarea[name="description"]',
              submitButton: 'button:has-text("Save Collection")',
            },
          },
          assertions: [
            { type: "created_entity_visible", entityType: "collection" },
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
      assert.equal(page.deletedEntities.length, 1);
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
