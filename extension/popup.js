const PROJECTS_KEY = "projects";

let projects = [];
let activeProjectId = null;
let message = "";
let deleteConfirmation = false;
let noteTimer = null;
let resourceFormMode = "";
let editingResourceId = null;
let linkForm = { url: "", title: "", multiText: "", showMany: false, message: "" };
let editForm = null;
let projectSearch = "";
let importText = "";
let importedProjects = null;
let importConfirmation = "";
let importOpen = false;

document.addEventListener("DOMContentLoaded", initialize);

async function initialize() {
  try {
    const saved = await chrome.storage.local.get(PROJECTS_KEY);
    projects = Array.isArray(saved[PROJECTS_KEY]) ? saved[PROJECTS_KEY] : [];
  } catch (error) {
    setMessage("Could not load projects.");
  }
  render();
}

function render() {
  const app = document.getElementById("app");
  app.replaceChildren(activeProjectId ? createDetailScreen() : createListScreen());
}

function createListScreen() {
  const screen = element("section", "screen");
  const header = element("header", "list-header");
  header.append(element("h1", "app-title", "ProjDock"), createNewProjectButton());
  screen.append(header, createMessage(), createProjectSearch());

  const searchTerm = projectSearch.trim().toLowerCase();
  const sortedProjects = [...projects]
    .filter((project) => String(project.name || "").toLowerCase().includes(searchTerm))
    .sort(sortProjects);

  if (!sortedProjects.length) {
    screen.append(element(
      "p",
      "empty-state",
      projects.length ? "No projects match your search." : "No projects yet. Create your first dock."
    ));
  } else {
    const list = element("div", "project-list");
    sortedProjects.forEach((project) => list.append(createProjectCard(project)));
    screen.append(list);
  }
  screen.append(createBackupControl());
  return screen;
}

function sortProjects(first, second) {
  if (Boolean(first.pinned) !== Boolean(second.pinned)) {
    return first.pinned ? -1 : 1;
  }
  return new Date(second.lastWorkedAt) - new Date(first.lastWorkedAt);
}

function createProjectSearch() {
  const input = document.createElement("input");
  input.className = "project-search";
  input.type = "search";
  input.placeholder = "Search projects";
  input.value = projectSearch;
  input.setAttribute("aria-label", "Search projects");
  input.addEventListener("input", () => updateProjectSearch(input));
  return input;
}

function updateProjectSearch(input) {
  const selectionStart = input.selectionStart;
  projectSearch = input.value;
  render();
  const nextInput = document.querySelector(".project-search");
  if (nextInput) {
    nextInput.focus();
    nextInput.setSelectionRange(selectionStart, selectionStart);
  }
}

function createBackupControl() {
  const area = element("section", "backup-area");
  const actions = element("div", "backup-actions");
  const exportButton = element("button", "secondary-button", "Export backup");
  exportButton.type = "button";
  exportButton.addEventListener("click", exportBackup);
  const importButton = element("button", "secondary-button", "Import backup");
  importButton.type = "button";
  importButton.addEventListener("click", () => {
    importedProjects = null;
    importConfirmation = "";
    importText = "";
    importOpen = true;
    render();
  });
  actions.append(exportButton, importButton);
  area.append(actions);
  if (importOpen) area.append(createImportBackupForm());
  return area;
}

function createImportBackupForm() {
  const form = element("form", "import-form");
  const textarea = document.createElement("textarea");
  textarea.rows = 7;
  textarea.placeholder = "Paste a ProjDock backup here";
  textarea.value = importText;
  textarea.setAttribute("aria-label", "Backup JSON");
  textarea.addEventListener("input", () => { importText = textarea.value; });
  const validate = element("button", "primary-button", "Validate backup");
  validate.type = "submit";
  const cancel = element("button", "text-button", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", clearImport);
  form.append(textarea, validate, cancel);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    validateBackup();
  });
  if (importedProjects && !importConfirmation) form.append(createImportOptions());
  if (importConfirmation) form.append(createImportConfirmation());
  return form;
}

function createImportOptions() {
  const options = element("div", "import-options");
  options.append(element("p", "form-message", `Backup ready: ${importedProjects.length} projects.`));
  const merge = element("button", "secondary-button", "Merge");
  merge.type = "button";
  merge.addEventListener("click", () => {
    importConfirmation = "merge";
    render();
  });
  const replace = element("button", "danger-button", "Replace all");
  replace.type = "button";
  replace.addEventListener("click", () => {
    importConfirmation = "replace";
    render();
  });
  options.append(merge, replace);
  return options;
}

function createImportConfirmation() {
  const confirmation = element("div", "import-confirmation");
  const copy = importConfirmation === "replace"
    ? "Replace all current projects with this backup?"
    : "Merge this backup with current projects? Existing project IDs will be skipped.";
  confirmation.append(element("p", "confirm-text", copy));
  const confirm = element("button", importConfirmation === "replace" ? "danger-button" : "primary-button", "Confirm import");
  confirm.type = "button";
  confirm.addEventListener("click", applyImport);
  const cancel = element("button", "text-button", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => {
    importConfirmation = "";
    render();
  });
  confirmation.append(confirm, cancel);
  return confirmation;
}

function clearImport() {
  importText = "";
  importedProjects = null;
  importConfirmation = "";
  importOpen = false;
  render();
}

function exportBackup() {
  try {
    const blob = new Blob([JSON.stringify(projects, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "projdock-backup.json";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setMessage("Backup exported.");
  } catch (error) {
    setMessage("Could not export the backup.");
  }
}

function validateBackup() {
  try {
    const parsed = JSON.parse(importText);
    if (!Array.isArray(parsed) || !parsed.every(isBackupProject)) throw new Error("Invalid backup");
    importedProjects = parsed.map(normalizeImportedProject);
    importConfirmation = "";
    setMessage("Backup validated.");
  } catch (error) {
    importedProjects = null;
    importConfirmation = "";
    setMessage("Please paste a valid ProjDock backup.");
  }
}

function isBackupProject(project) {
  return project && typeof project === "object" && typeof project.id === "string" &&
    typeof project.name === "string" && Array.isArray(project.resources) &&
    project.resources.every((resource) => resource && typeof resource === "object" &&
      typeof resource.id === "string" && typeof resource.value === "string");
}

function normalizeImportedProject(project) {
  return {
    ...project,
    pinned: Boolean(project.pinned),
    resources: project.resources.map((resource) => ({
      ...resource,
      label: typeof resource.label === "string" ? resource.label : ""
    }))
  };
}

async function applyImport() {
  if (!importedProjects || !importConfirmation) return;
  let importedCount = importedProjects.length;
  let skipped = 0;
  if (importConfirmation === "replace") {
    projects = importedProjects;
  } else {
    const existingIds = new Set(projects.map((project) => project.id));
    const additions = [];
    importedProjects.forEach((project) => {
      if (existingIds.has(project.id)) {
        skipped += 1;
        return;
      }
      existingIds.add(project.id);
      additions.push(project);
    });
    importedCount = additions.length;
    projects = projects.concat(additions);
  }
  clearImport();
  await saveProjects(`Imported ${importedCount} projects, skipped ${skipped}.`);
}

function createNewProjectButton() {
  const button = element("button", "primary-button", "New project");
  button.type = "button";
  button.addEventListener("click", showNewProjectForm);
  return button;
}

function showNewProjectForm() {
  const header = document.querySelector(".list-header");
  const existing = document.querySelector(".new-project-form");
  if (existing) {
    existing.querySelector("input").focus();
    return;
  }

  const form = element("form", "new-project-form");
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Project name";
  input.maxLength = 100;
  input.required = true;
  input.setAttribute("aria-label", "Project name");
  const save = element("button", "primary-button", "Create");
  save.type = "submit";
  const cancel = element("button", "text-button", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => form.remove());
  form.append(input, save, cancel);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    const now = new Date().toISOString();
    projects.push({
      id: crypto.randomUUID(),
      name,
      note: "",
      createdAt: now,
      lastWorkedAt: now,
      resources: []
    });
    await saveProjects("Project created.");
  });
  header.after(form);
  input.focus();
}

function createProjectCard(project) {
  const card = element("article", "project-card");
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  const content = element("div", "project-summary");
  content.append(
    element("h2", "project-name", project.name),
    element("p", "project-meta", `${project.resources.length} ${project.resources.length === 1 ? "tab" : "tabs"}`),
    element("p", "project-meta", `Last worked: ${readableDate(project.lastWorkedAt)}`)
  );
  const openButton = element("button", "secondary-button", "Open all");
  openButton.type = "button";
  openButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    await openAllTabs(project);
  });
  const pin = element("button", "icon-button pin-button", project.pinned ? "★" : "☆");
  pin.type = "button";
  pin.setAttribute("aria-label", project.pinned ? "Unpin project" : "Pin project");
  pin.title = project.pinned ? "Unpin project" : "Pin project";
  pin.addEventListener("click", async (event) => {
    event.stopPropagation();
    project.pinned = !project.pinned;
    await saveProjects(project.pinned ? "Project pinned." : "Project unpinned.");
  });
  const actions = element("div", "project-card-actions");
  actions.append(pin, openButton);
  card.append(content, actions);
  card.addEventListener("click", () => openProject(project.id));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openProject(project.id);
    }
  });
  return card;
}

function createDetailScreen() {
  const project = findActiveProject();
  if (!project) {
    activeProjectId = null;
    return createListScreen();
  }

  const screen = element("section", "screen");
  const topBar = element("header", "detail-header");
  const back = element("button", "icon-button", "←");
  back.type = "button";
  back.setAttribute("aria-label", "Back to projects");
  back.addEventListener("click", closeProject);
  const nameInput = document.createElement("input");
  nameInput.className = "project-title-input";
  nameInput.value = project.name;
  nameInput.maxLength = 100;
  nameInput.setAttribute("aria-label", "Project name");
  nameInput.addEventListener("change", () => updateProjectName(project, nameInput.value));
  topBar.append(back, nameInput);

  const note = document.createElement("textarea");
  note.className = "note-input";
  note.placeholder = "Add a note…";
  note.value = project.note || "";
  note.rows = 3;
  note.setAttribute("aria-label", "Project note");
  note.addEventListener("input", () => scheduleNoteSave(project, note.value));
  note.addEventListener("change", () => saveNoteNow(project, note.value));

  const actions = element("div", "detail-actions");
  const saveTabs = element("button", "primary-button", "Save current tabs");
  saveTabs.type = "button";
  saveTabs.addEventListener("click", saveCurrentTabs);
  const addLink = element("button", "secondary-button", "Add link");
  addLink.type = "button";
  addLink.addEventListener("click", () => toggleResourceForm("link"));
  const addCurrentTab = element("button", "secondary-button", "Add this tab");
  addCurrentTab.type = "button";
  addCurrentTab.addEventListener("click", saveCurrentTab);
  const openAll = element("button", "secondary-button", "Open all");
  openAll.type = "button";
  openAll.addEventListener("click", () => openAllTabs(project));
  const copyAll = element("button", "secondary-button", "Copy all links");
  copyAll.type = "button";
  copyAll.addEventListener("click", () => copyAllLinks(project));
  actions.append(saveTabs, addLink, addCurrentTab, openAll, copyAll);

  screen.append(
    topBar,
    note,
    actions,
    createMessage(),
    resourceFormMode ? createAddLinkForm(project) : document.createDocumentFragment(),
    createResourceList(project),
    createDeleteControl(project)
  );
  return screen;
}

function createResourceList(project) {
  if (!project.resources.length) {
    return element("p", "empty-state", "No tabs saved yet.");
  }
  const list = element("ul", "resource-list");
  project.resources.forEach((resource) => list.append(createResourceItem(project, resource)));
  return list;
}

function createResourceItem(project, resource) {
  const item = element("li", "resource-item");
  if (editingResourceId === resource.id) {
    item.append(createResourceEditForm(project, resource));
    return item;
  }
  const open = element("button", "resource-open");
  open.type = "button";
  open.addEventListener("click", () => openSingleTab(resource));
  open.append(createFavicon(resource), element("span", "resource-copy"));
  const copy = open.lastElementChild;
  const titleLine = element("span", "resource-title", resource.title || resource.value);
  if (resource.label) titleLine.append(element("span", "resource-label", resource.label));
  copy.append(titleLine, element("span", "resource-domain", getDomain(resource.value)));
  const moveUp = element("button", "move-button", "↑");
  moveUp.type = "button";
  moveUp.title = "Move up";
  moveUp.setAttribute("aria-label", "Move up");
  moveUp.disabled = project.resources.indexOf(resource) === 0;
  moveUp.addEventListener("click", () => moveResource(project.id, resource.id, -1));
  const moveDown = element("button", "move-button", "↓");
  moveDown.type = "button";
  moveDown.title = "Move down";
  moveDown.setAttribute("aria-label", "Move down");
  moveDown.disabled = project.resources.indexOf(resource) === project.resources.length - 1;
  moveDown.addEventListener("click", () => moveResource(project.id, resource.id, 1));
  const edit = element("button", "edit-button", "Edit");
  edit.type = "button";
  edit.addEventListener("click", () => {
    editingResourceId = resource.id;
    resourceFormMode = "";
    editForm = {
      id: resource.id,
      title: resource.title || "",
      url: resource.value || "",
      label: resource.label || "",
      message: ""
    };
    render();
  });
  const remove = element("button", "remove-button", "Remove");
  remove.type = "button";
  remove.addEventListener("click", () => removeResource(project.id, resource.id));
  item.append(open, moveUp, moveDown, edit, remove);
  return item;
}

function toggleResourceForm(mode) {
  resourceFormMode = resourceFormMode === mode ? "" : mode;
  editingResourceId = null;
  editForm = null;
  linkForm = { url: "", title: "", multiText: "", showMany: false, message: "" };
  render();
}

function createAddLinkForm(project) {
  const form = element("form", "resource-form");
  const url = document.createElement("input");
  url.type = "text";
  url.inputMode = "url";
  url.placeholder = "https://example.com";
  url.setAttribute("aria-required", "true");
  url.value = linkForm.url;
  url.setAttribute("aria-label", "Link URL");
  url.addEventListener("input", () => { linkForm.url = url.value; });
  const title = document.createElement("input");
  title.type = "text";
  title.placeholder = "Title (optional)";
  title.maxLength = 200;
  title.value = linkForm.title;
  title.setAttribute("aria-label", "Link title");
  title.addEventListener("input", () => { linkForm.title = title.value; });
  const add = element("button", "primary-button", "Add");
  add.type = "submit";
  const cancel = element("button", "text-button", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => toggleResourceForm("link"));
  form.append(url, title, add, cancel);

  const manyToggle = element("button", "text-button form-link", "Paste multiple links");
  manyToggle.type = "button";
  manyToggle.addEventListener("click", () => {
    linkForm.showMany = !linkForm.showMany;
    linkForm.message = "";
    render();
  });
  form.append(manyToggle);
  if (linkForm.showMany) form.append(createManyLinksControls(project));
  if (linkForm.message) form.append(element("p", "form-message", linkForm.message));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await addManualLink(project, linkForm.url, linkForm.title);
  });
  return form;
}

function createManyLinksControls(project) {
  const area = element("div", "many-links-area");
  const textarea = document.createElement("textarea");
  textarea.rows = 5;
  textarea.placeholder = "One link per line";
  textarea.value = linkForm.multiText;
  textarea.setAttribute("aria-label", "Links to add, one per line");
  textarea.addEventListener("input", () => { linkForm.multiText = textarea.value; });
  const addAll = element("button", "secondary-button", "Add all");
  addAll.type = "button";
  addAll.addEventListener("click", () => addManyLinks(project));
  area.append(textarea, addAll);
  return area;
}

async function addManualLink(project, value, title) {
  const url = normalizeLink(value);
  if (!url) {
    linkForm.message = "Please enter a valid link";
    render();
    return;
  }
  if (hasSavedUrl(project, url)) {
    linkForm.message = "Link already saved";
    render();
    return;
  }
  project.resources.push(createLinkResource(url, title));
  project.lastWorkedAt = new Date().toISOString();
  resourceFormMode = "";
  linkForm = { url: "", title: "", multiText: "", showMany: false, message: "" };
  await saveProjects("Link saved.");
}

async function addManyLinks(project) {
  const lines = linkForm.multiText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const savedUrls = new Set(project.resources.map((resource) => resource.value));
  let added = 0;
  let skipped = 0;
  lines.forEach((line) => {
    const url = normalizeLink(line);
    if (!url || savedUrls.has(url)) {
      skipped += 1;
      return;
    }
    project.resources.push(createLinkResource(url, ""));
    savedUrls.add(url);
    added += 1;
  });
  if (added) project.lastWorkedAt = new Date().toISOString();
  linkForm.multiText = "";
  linkForm.message = `Added ${added}, skipped ${skipped}`;
  try {
    await chrome.storage.local.set({ [PROJECTS_KEY]: projects });
    render();
  } catch (error) {
    linkForm.message = "Could not save your changes.";
    render();
  }
}

function normalizeLink(value) {
  const candidate = value.trim();
  if (!candidate) return "";
  const hasProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(candidate) ||
    /^(mailto|tel|file|data):/i.test(candidate);
  const withProtocol = hasProtocol ? candidate : `https://${candidate}`;
  try {
    const url = new URL(withProtocol);
    return url.href;
  } catch (error) {
    return "";
  }
}

function hasSavedUrl(project, url, exceptId) {
  return project.resources.some((resource) => resource.id !== exceptId && resource.value === url);
}

function createLinkResource(url, title) {
  const domain = getDomain(url);
  return {
    id: crypto.randomUUID(),
    type: "link",
    title: title.trim() || domain,
    value: url,
    favicon: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`
  };
}

function createResourceEditForm(project, resource) {
  const form = element("form", "resource-edit-form");
  const title = document.createElement("input");
  title.type = "text";
  title.placeholder = "Title";
  title.maxLength = 200;
  title.value = editForm ? editForm.title : resource.title || "";
  title.setAttribute("aria-label", "Item title");
  title.addEventListener("input", () => { editForm.title = title.value; });
  const url = document.createElement("input");
  url.type = "text";
  url.inputMode = "url";
  url.placeholder = "URL";
  url.setAttribute("aria-required", "true");
  url.value = editForm ? editForm.url : resource.value;
  url.setAttribute("aria-label", "Item URL");
  url.addEventListener("input", () => { editForm.url = url.value; });
  const label = document.createElement("input");
  label.type = "text";
  label.placeholder = "Label (optional)";
  label.maxLength = 50;
  label.value = editForm ? editForm.label : resource.label || "";
  label.setAttribute("aria-label", "Item label");
  label.addEventListener("input", () => { editForm.label = label.value; });
  const save = element("button", "primary-button", "Save");
  save.type = "submit";
  const cancel = element("button", "text-button", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => {
    editingResourceId = null;
    editForm = null;
    render();
  });
  form.append(title, url, label, save, cancel);
  if (editForm && editForm.message) form.append(element("p", "form-message", editForm.message));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveResourceEdit(project, resource);
  });
  return form;
}

async function saveResourceEdit(project, resource) {
  const url = normalizeLink(editForm.url);
  if (!url) {
    editForm.message = "Please enter a valid link";
    render();
    return;
  }
  if (hasSavedUrl(project, url, resource.id)) {
    editForm.message = "Link already saved";
    render();
    return;
  }
  resource.value = url;
  resource.title = editForm.title.trim() || getDomain(url);
  resource.label = editForm.label.trim();
  if (resource.type === "link") {
    resource.favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(getDomain(url))}&sz=64`;
  }
  project.lastWorkedAt = new Date().toISOString();
  editingResourceId = null;
  editForm = null;
  await saveProjects("Item saved.");
}

function createFavicon(resource) {
  if (resource.favicon) {
    const image = document.createElement("img");
    image.className = "favicon";
    image.src = resource.favicon;
    image.alt = "";
    image.addEventListener("error", () => image.replaceWith(element("span", "favicon-fallback", "◈")));
    return image;
  }
  return element("span", "favicon-fallback", "◈");
}

function createDeleteControl(project) {
  const area = element("div", "delete-area");
  if (deleteConfirmation) {
    area.append(element("p", "confirm-text", "Delete this project permanently?"));
    const confirm = element("button", "danger-button", "Confirm delete");
    confirm.type = "button";
    confirm.addEventListener("click", () => deleteProject(project.id));
    const cancel = element("button", "text-button", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", () => {
      deleteConfirmation = false;
      render();
    });
    area.append(confirm, cancel);
  } else {
    const remove = element("button", "danger-button", "Delete project");
    remove.type = "button";
    remove.addEventListener("click", () => {
      deleteConfirmation = true;
      render();
    });
    area.append(remove);
  }
  return area;
}

async function saveCurrentTabs() {
  const project = findActiveProject();
  if (!project) return;
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const savedUrls = new Set(project.resources.map((resource) => resource.value));
    let saved = 0;
    let skipped = 0;
    tabs.forEach((tab) => {
      if (!isSavableUrl(tab.url) || savedUrls.has(tab.url)) {
        skipped += 1;
        return;
      }
      project.resources.push({
        id: crypto.randomUUID(),
        type: "tab",
        title: tab.title || tab.url,
        value: tab.url,
        favicon: tab.favIconUrl || ""
      });
      savedUrls.add(tab.url);
      saved += 1;
    });
    project.lastWorkedAt = new Date().toISOString();
    await saveProjects(`Saved ${saved} ${saved === 1 ? "tab" : "tabs"}, skipped ${skipped}.`);
  } catch (error) {
    setMessage("Could not read the current tabs.");
  }
}

async function saveCurrentTab() {
  const project = findActiveProject();
  if (!project) return;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab || !isSavableUrl(tab.url) || hasSavedUrl(project, tab.url)) {
      setMessage("This tab is already saved or cannot be saved.");
      return;
    }
    project.resources.push({
      id: crypto.randomUUID(),
      type: "tab",
      title: tab.title || tab.url,
      value: tab.url,
      favicon: tab.favIconUrl || ""
    });
    project.lastWorkedAt = new Date().toISOString();
    await saveProjects("Saved 1 tab, skipped 0.");
  } catch (error) {
    setMessage("Could not read the current tab.");
  }
}

function isSavableUrl(url) {
  return Boolean(url) && !/^(chrome:|chrome-extension:|edge:|about:)/i.test(url);
}

async function openAllTabs(project) {
  const urls = project.resources.map((resource) => resource.value).filter(isSavableUrl);
  if (!urls.length) {
    setMessage("There are no saved tabs to open.");
    return;
  }
  try {
    await chrome.windows.create({ url: urls });
    project.lastWorkedAt = new Date().toISOString();
    await saveProjects("Opened saved tabs in a new window.");
  } catch (error) {
    setMessage("Could not open the saved tabs.");
  }
}

async function openSingleTab(resource) {
  try {
    await chrome.tabs.create({ url: resource.value });
  } catch (error) {
    setMessage("Could not open this tab.");
  }
}

async function copyAllLinks(project) {
  const urls = project.resources.map((resource) => resource.value).filter(Boolean);
  if (!urls.length) {
    setMessage("There are no saved links to copy.");
    return;
  }
  try {
    await navigator.clipboard.writeText(urls.join("\n"));
    setMessage(`Copied ${urls.length} ${urls.length === 1 ? "link" : "links"}.`);
  } catch (error) {
    setMessage("Could not copy the saved links.");
  }
}

async function moveResource(projectId, resourceId, direction) {
  const project = projects.find((item) => item.id === projectId);
  if (!project) return;
  const index = project.resources.findIndex((resource) => resource.id === resourceId);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= project.resources.length) return;
  [project.resources[index], project.resources[targetIndex]] = [
    project.resources[targetIndex],
    project.resources[index]
  ];
  project.lastWorkedAt = new Date().toISOString();
  await saveProjects("Item moved.");
}

async function removeResource(projectId, resourceId) {
  const project = projects.find((item) => item.id === projectId);
  if (!project) return;
  project.resources = project.resources.filter((resource) => resource.id !== resourceId);
  project.lastWorkedAt = new Date().toISOString();
  await saveProjects("Item removed.");
}

async function deleteProject(projectId) {
  projects = projects.filter((project) => project.id !== projectId);
  activeProjectId = null;
  deleteConfirmation = false;
  await saveProjects("Project deleted.");
}

async function updateProjectName(project, value) {
  const name = value.trim();
  if (!name) {
    render();
    return;
  }
  project.name = name;
  await saveProjects("Project name saved.");
}

function scheduleNoteSave(project, value) {
  clearTimeout(noteTimer);
  noteTimer = setTimeout(async () => {
    await saveNoteNow(project, value);
  }, 400);
}

async function saveNoteNow(project, value) {
  clearTimeout(noteTimer);
  project.note = value;
  await saveProjects("Note saved.");
}

async function saveProjects(successMessage) {
  try {
    await chrome.storage.local.set({ [PROJECTS_KEY]: projects });
    setMessage(successMessage);
  } catch (error) {
    setMessage("Could not save your changes.");
  }
}

function openProject(projectId) {
  activeProjectId = projectId;
  deleteConfirmation = false;
  message = "";
  render();
}

function closeProject() {
  clearTimeout(noteTimer);
  activeProjectId = null;
  deleteConfirmation = false;
  message = "";
  render();
}

function findActiveProject() {
  return projects.find((project) => project.id === activeProjectId);
}

function setMessage(text) {
  message = text;
  render();
}

function createMessage() {
  return message ? element("p", "status-message", message) : document.createDocumentFragment();
}

function readableDate(value) {
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(value).toLocaleDateString();
}

function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch (error) {
    return url;
  }
}

function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
