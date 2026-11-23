"use strict";

// A file:// page cannot reliably fetch JSON. This copy only supplies the opening demo.
// User albums and the hosted site both read a JSON manifest.
const demoPhotos = [
  {file:"photos/生活/sample.svg",title:"生活示例",category:"生活",tags:["示例"],date:"2026-01-01"},
  {file:"photos/旅行/sample.svg",title:"旅行示例",category:"旅行",tags:["示例"],date:"2026-01-01"},
  {file:"photos/风景/sample.svg",title:"风景示例",category:"风景",tags:["示例"],date:"2026-01-01"}
];
const samplePaths = new Set(demoPhotos.map(photo => photo.file));

const search = document.querySelector("#search");
const filters = document.querySelector("#filters");
const grid = document.querySelector("#grid");
const count = document.querySelector("#count");
const empty = document.querySelector("#empty");
const loadError = document.querySelector("#load-error");
const template = document.querySelector("#photo-template");
const importButton = document.querySelector("#import-button");
const fileInput = document.querySelector("#file-input");
const lightbox = document.querySelector("#lightbox");
const largeImage = document.querySelector("#large-image");
const largeError = document.querySelector("#large-error");
const largeTitle = document.querySelector("#lightbox-title");
const largeDate = document.querySelector("#lightbox-date");
const position = document.querySelector("#lightbox-position");
const previous = document.querySelector("#previous");
const next = document.querySelector("#next");
const year = document.querySelector("#year");
const sort = document.querySelector("#sort");
const resetFilters = document.querySelector("#reset-filters");
const retryLoad = document.querySelector("#retry-load");
const importStatus = document.querySelector("#import-status");
const largeLoading = document.querySelector("#large-loading");
const lightboxTags = document.querySelector("#lightbox-tags");
const stage = document.querySelector(".lightbox-stage");
const titleOrder = new Intl.Collator("zh-CN", {numeric: true});
const folderInput = document.querySelector("#folder-input");
const privateStatus = document.querySelector("#private-status");
const clearPrivate = document.querySelector("#clear-private");
const privateFiles = new Map();
const storedFiles = new Map();
const storedKeys = new Set();
const privateUrls = new Map();
const imageExtensions = /\.(?:jpe?g|png|webp|gif|avif|bmp)$/i;
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/bmp"]);
const archiveInput = document.querySelector("#archive-input");
const addDialog = document.querySelector("#add-dialog");
const addForm = document.querySelector("#add-form");
const addFields = document.querySelector("#add-fields");
const addError = document.querySelector("#add-error");
const addStatus = document.querySelector("#add-status");
const saveAdd = document.querySelector("#save-add");
const newPhoto = document.querySelector("#new-photo");
const newTitle = document.querySelector("#new-title");
const newCategory = document.querySelector("#new-category");
const newDate = document.querySelector("#new-date");
const newTags = document.querySelector("#new-tags");
const exportPrivate = document.querySelector("#export-private");
const sessionAdditions = new Map();
const downloadUrls = new Set();

let photos = [];
let visiblePhotos = [];
let activeCategory = null;
let currentIndex = 0;
let opener = null;
let loadVersion = 0;
let imageVersion = 0;
let swipe = null;
let hasLocalManifest = false;
let addVersion = 0;
let exportVersion = 0;
let exportBusy = false;
let database = null;
let viewMode = "wall";
let importing = false;

function isText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizePhotos(records) {
  if (!Array.isArray(records)) throw new Error("照片清单必须是 JSON 数组。");

  return records.map((record, index) => {
    const {file, title, category, tags, date, milestone = false, dateSource = "unknown", travelCandidate = false} = record ?? {};
    const parts = typeof file === "string" ? file.split("/") : [];
    const validPath = parts[0] === "photos" && parts.length >= 3 &&
      parts.every(part => isText(part) && part !== "." && part !== ".." && !/[\\:\u0000-\u001f]/.test(part));

    if (!validPath || (!imageExtensions.test(file) && !samplePaths.has(file)) || !isText(title) || !isText(category) ||
        !Array.isArray(tags) || !tags.every(isText) || !validDate(date) || typeof milestone !== "boolean" ||
        typeof travelCandidate !== "boolean" || !["unknown", "exif", "modified"].includes(dateSource)) {
      throw new Error(`第 ${index + 1} 条记录有误，请检查图片路径、标题、分类、标签和日期。`);
    }

    return {
      title: title.trim(),
      category: category.trim(),
      date,
      milestone,
      dateSource,
      travelCandidate,
      file,
      private: parts[1].toLowerCase() === "private",
      tags: [...new Set(tags.map(tag => tag.trim()))],
      src: "./" + parts.map(encodeURIComponent).join("/"),
      searchText: [title, ...tags].join("\n").toLocaleLowerCase("zh-CN")
    };
  }).sort((a, b) => b.date.localeCompare(a.date));
}

function photoSource(photo) {
  if (!photo.private) return photo.src;
  const file = privateFiles.get(photo.file);
  if (!file) return null;
  if (!privateUrls.has(photo.file)) privateUrls.set(photo.file, URL.createObjectURL(file));
  return privateUrls.get(photo.file);
}

function revokePrivateUrls() {
  for (const url of privateUrls.values()) URL.revokeObjectURL(url);
  privateUrls.clear();
}

function updatePrivateStatus() {
  const required = photos.filter(photo => photo.private);
  const matched = required.filter(photo => privateFiles.has(photo.file)).length;
  privateStatus.textContent = required.length
    ? `私人照片已匹配 ${matched} / ${required.length} 张，仅供当前页面预览`
    : "当前清单使用普通照片路径";
  clearPrivate.hidden = !hasLocalManifest && privateFiles.size === 0;
  exportPrivate.hidden = required.length === 0;
  document.querySelector("#export-help").hidden = required.length === 0;
  exportPrivate.disabled = exportBusy || matched !== required.length;
  exportPrivate.title = matched !== required.length ? "请先选择 photos 文件夹，补齐私人照片" : "";
}

function setPhotos(records) {
  const normalized = normalizePhotos(records);
  photos = normalized;
  ++exportVersion;
  revokePrivateUrls();
  activeCategory = null;
  search.value = "";
  year.replaceChildren(new Option("全部年份", ""));
  const years = [...new Set(photos.map(photo => photo.date.slice(0, 4)))];
  years.forEach(value => year.add(new Option(value + " 年", value)));
  loadError.hidden = true;
  retryLoad.hidden = true;
  importStatus.hidden = true;
  renderFilters();
  renderGrid();
  updatePrivateStatus();
}

function clearFilters() {
  activeCategory = null;
  search.value = "";
  year.value = "";
  renderFilters();
  renderGrid();
}

function renderFilters() {
  const categories = [...new Set(photos.map(photo => photo.category))];
  filters.replaceChildren();

  for (const category of [null, ...categories]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter";
    button.textContent = category ?? "全部";
    button.setAttribute("aria-pressed", String(category === activeCategory));
    button.addEventListener("click", () => {
      activeCategory = category;
      filters.querySelector('[aria-pressed="true"]').setAttribute("aria-pressed", "false");
      button.setAttribute("aria-pressed", "true");
      renderGrid();
    });
    filters.append(button);
  }
}

function setDate(element, date) {
  element.dateTime = date;
  element.textContent = date.replaceAll("-", ".");
}

function renderGrid() {
  const query = search.value.trim().toLocaleLowerCase("zh-CN");
  const terms = query ? query.split(/\s+/) : [];
  visiblePhotos = photos.filter(photo =>
    (activeCategory === null || photo.category === activeCategory) &&
    (!year.value || photo.date.startsWith(year.value)) &&
    terms.every(term => photo.searchText.includes(term))
  );
  if (sort.value === "oldest") visiblePhotos.sort((a, b) => a.date.localeCompare(b.date));
  if (sort.value === "title") visiblePhotos.sort((a, b) => titleOrder.compare(a.title, b.title));

  const fragment = document.createDocumentFragment();
  visiblePhotos.forEach((photo, index) => {
    const card = template.content.cloneNode(true);
    const button = card.querySelector(".photo-button");
    const image = card.querySelector("img");
    const imageError = card.querySelector(".image-error");
    image.loading = index < 3 ? "eager" : "lazy";
    image.addEventListener("error", () => {
      image.hidden = true;
      imageError.hidden = false;
      imageError.textContent = "图片缺失，点开查看";
    });
    const src = photoSource(photo);
    if (src) {
      image.src = src;
    } else {
      image.hidden = true;
      imageError.hidden = false;
      imageError.textContent = "请选择本机 photos 文件夹";
    }
    card.querySelector(".card-title").textContent = photo.title;
    const category = card.querySelector(".card-category");
    category.textContent = photo.category;
    category.title = photo.category;
    setDate(card.querySelector("time"), photo.date);
    button.addEventListener("click", () => openLightbox(index, button));
    fragment.append(card);
  });
  grid.replaceChildren(fragment);
  renderTimeline();
  count.textContent = `${visiblePhotos.length} / ${photos.length} 张照片`;
  resetFilters.disabled = activeCategory === null && !year.value && !query;
  empty.hidden = visiblePhotos.length > 0;
  empty.textContent = photos.length ? "没有匹配的照片，试试其他关键词或分类。" : "相册里还没有照片。";
}

function openLightbox(index, button) {
  currentIndex = index;
  opener = button;
  updateLightbox();
  lightbox.showModal();
}

function updateLightbox() {
  const photo = visiblePhotos[currentIndex];
  const version = ++imageVersion;
  swipe = null;
  largeImage.hidden = true;
  largeError.hidden = true;
  largeLoading.hidden = false;
  stage.setAttribute("aria-busy", "true");
  // Each request has its own Image, so a previous load cannot overwrite the next photo.
  const src = photoSource(photo);
  largeError.querySelector("p").textContent = src
    ? "照片无法显示，请检查文件是否存在及路径大小写。"
    : "请先选择本机 photos 文件夹，以读取这张私人照片。";
  const request = new Image();
  request.onload = () => {
    if (version !== imageVersion || !lightbox.open) return;
    largeImage.src = src;
    largeImage.hidden = false;
    largeLoading.hidden = true;
    stage.setAttribute("aria-busy", "false");
  };
  request.onerror = () => {
    if (version !== imageVersion || !lightbox.open) return;
    largeLoading.hidden = true;
    largeError.hidden = false;
    stage.setAttribute("aria-busy", "false");
  };
  largeImage.alt = photo.title;
  if (src) {
    request.src = src;
  } else {
    largeLoading.hidden = true;
    largeError.hidden = false;
    stage.setAttribute("aria-busy", "false");
  }
  largeTitle.textContent = photo.title;
  setDate(largeDate, photo.date);
  position.textContent = `${currentIndex + 1} / ${visiblePhotos.length}`;
  const categorySelect = document.querySelector("#photo-category");
  const categoryOption = [...categorySelect.options].find(option => option.value === photo.category);
  if (!categoryOption) categorySelect.add(new Option(photo.category, photo.category));
  categorySelect.value = photo.category;
  categorySelect.disabled = !photo.private || !privateFiles.has(photo.file) || !database;
  const milestoneButton = document.querySelector("#milestone");
  milestoneButton.disabled = categorySelect.disabled;
  milestoneButton.setAttribute("aria-pressed", String(photo.milestone));
  milestoneButton.textContent = photo.milestone ? "取消里程碑" : "标记里程碑";
  previous.hidden = next.hidden = visiblePhotos.length < 2;
  lightboxTags.replaceChildren();
  for (const tag of photo.tags) {
    const button = document.createElement("button");
    button.className = "text-button";
    button.type = "button";
    button.textContent = "#" + tag;
    button.setAttribute("aria-label", "搜索标签 " + tag);
    button.addEventListener("click", () => {
      lightbox.close();
      clearFilters();
      search.value = tag;
      renderGrid();
      search.focus();
    });
    lightboxTags.append(button);
  }
}

function movePhoto(step) {
  const total = visiblePhotos.length;
  if (total < 2) return;
  currentIndex = (currentIndex + step + total) % total;
  updateLightbox();
}

document.querySelector(".search").addEventListener("submit", event => event.preventDefault());
search.addEventListener("input", renderGrid);
year.addEventListener("change", renderGrid);
sort.addEventListener("change", renderGrid);
resetFilters.addEventListener("click", clearFilters);
previous.addEventListener("click", () => movePhoto(-1));
next.addEventListener("click", () => movePhoto(1));
document.querySelector("#close").addEventListener("click", () => lightbox.close());
document.querySelector("#retry-image").addEventListener("click", updateLightbox);
lightbox.addEventListener("close", () => {
  imageVersion++;
  swipe = null;
  if (opener?.isConnected) opener.focus();
});
lightbox.addEventListener("click", event => {
  if (event.target === lightbox) lightbox.close();
});

stage.addEventListener("pointerdown", event => {
  if (event.pointerType !== "touch") return;
  if (!event.isPrimary || event.target.closest("button")) {
    swipe = null;
    return;
  }
  swipe = {id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp};
  stage.setPointerCapture(event.pointerId);
});
stage.addEventListener("pointerup", event => {
  const start = swipe;
  swipe = null;
  if (!start || event.pointerId !== start.id) return;
  const deltaX = event.clientX - start.x;
  const deltaY = event.clientY - start.y;
  if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5 &&
      event.timeStamp - start.time < 800) {
    movePhoto(deltaX < 0 ? 1 : -1);
  }
});
stage.addEventListener("pointercancel", () => { swipe = null; });
stage.addEventListener("lostpointercapture", () => { swipe = null; });
lightbox.addEventListener("keydown", event => {
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    movePhoto(event.key === "ArrowLeft" ? -1 : 1);
  }
});

function showError(message) {
  loadError.textContent = message;
  loadError.hidden = false;
}

importButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  fileInput.value = "";
  const version = ++loadVersion;
  try {
    const records = JSON.parse(await file.text());
    if (version !== loadVersion) return;
    setPhotos(records);
    hasLocalManifest = true;
    updatePrivateStatus();
    importStatus.textContent = `已读取 ${file.name}，共 ${photos.length} 张照片。`;
    importStatus.hidden = false;
  } catch (error) {
    if (version !== loadVersion) return;
    renderGrid();
    showError(error instanceof SyntaxError ? "清单不是有效的 JSON，请检查引号和逗号。" : error.message);
  }
});

async function readManifest() {
  const version = ++loadVersion;
  count.textContent = "正在读取照片清单…";
  loadError.hidden = true;
  retryLoad.hidden = true;
  try {
    const response = await fetch("./photos.json", {
      cache: "no-store",
      credentials: "omit",
      mode: "same-origin",
      redirect: "error",
      referrerPolicy: "no-referrer"
    });
    if (!response.ok) throw new Error(`无法读取 photos.json（HTTP ${response.status}）。`);
    const records = await response.json();
    if (version !== loadVersion) return;
    if (normalizePhotos(records).some(photo => photo.private)) {
      throw new Error("根目录清单含私人照片记录，请将私人清单放在 photos/private/ 内，并手动读取。");
    }
    setPhotos(records);
  } catch (error) {
    if (version !== loadVersion) return;
    renderGrid();
    showError(error instanceof SyntaxError ? "photos.json 格式有误，请检查引号和逗号。" : error.message);
    retryLoad.hidden = false;
  }
}

retryLoad.addEventListener("click", readManifest);

document.querySelector("#select-folder").addEventListener("click", () => folderInput.click());
folderInput.addEventListener("change", () => {
  const selected = [...folderInput.files];
  folderInput.value = "";
  if (!selected.length) return;
  if (selected.some(file => !file.webkitRelativePath.startsWith("photos/"))) {
    showError("请选择名为 photos 的文件夹，以便与清单中的照片路径对应。");
    return;
  }
  ++imageVersion;
  lightbox.close();
  largeImage.removeAttribute("src");
  revokePrivateUrls();
  privateFiles.clear();
  for (const file of selected) {
    const parts = file.webkitRelativePath.split("/");
    if (parts[1]?.toLowerCase() === "private" && imageExtensions.test(file.name) &&
        (!file.type || imageTypes.has(file.type))) {
      privateFiles.set(file.webkitRelativePath, file);
    }
  }
  for (const [path, file] of sessionAdditions) privateFiles.set(path, file);
  for (const [path, file] of storedFiles) privateFiles.set(path, file);
  ++exportVersion;
  loadError.hidden = true;
  renderGrid();
  updatePrivateStatus();
});

function clearPrivatePreview() {
  ++loadVersion;
  ++imageVersion;
  lightbox.close();
  largeImage.removeAttribute("src");
  largeImage.alt = "";
  largeTitle.textContent = "";
  largeDate.textContent = "";
  largeDate.removeAttribute("datetime");
  lightboxTags.replaceChildren();
  position.textContent = "";
  revokePrivateUrls();
  privateFiles.clear();
  storedFiles.clear();
  sessionAdditions.clear();
  releaseDownloads();
  addDialog.close();
  hasLocalManifest = false;
  fileInput.value = "";
  folderInput.value = "";
  sort.value = "newest";
  setPhotos(demoPhotos);
  importStatus.textContent = "私人清单和照片预览已清除。";
  importStatus.hidden = false;
}

clearPrivate.addEventListener("click", clearPrivatePreview);

window.addEventListener("pagehide", () => {
  ++exportVersion;
  revokePrivateUrls();
  privateFiles.clear();
  storedFiles.clear();
  sessionAdditions.clear();
  releaseDownloads();
});
window.addEventListener("pageshow", event => {
  if (event.persisted) clearPrivatePreview();
});

function photoRecord(photo) {
  const {file, title, category, tags, date, milestone, dateSource, travelCandidate} = photo;
  return {file, title, category, tags: [...tags], date, milestone, dateSource, travelCandidate};
}

function renderTimeline() {
  const groups = document.querySelector("#timeline-groups");
  const summaries = document.querySelector("#year-summary");
  groups.replaceChildren();
  summaries.replaceChildren();
  const years = new Map();
  for (const photo of [...visiblePhotos].sort((a, b) => b.date.localeCompare(a.date))) {
    const y = photo.date.slice(0, 4);
    const m = photo.date.slice(5, 7);
    if (!years.has(y)) years.set(y, new Map());
    const months = years.get(y);
    if (!months.has(m)) months.set(m, []);
    months.get(m).push(photo);
  }
  for (const [y, months] of years) {
    const all = [...months.values()].flat();
    const busiest = [...months.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0];
    const summary = document.createElement("article");
    const heading = document.createElement("h3");
    heading.textContent = y + " 年";
    const detail = document.createElement("p");
    detail.textContent = `${all.length} 张照片 · 最热闹 ${Number(busiest[0])} 月（${busiest[1].length} 张） · ${all.filter(photo => photo.milestone).length} 个里程碑`;
    summary.append(heading, detail);
    summaries.append(summary);
    const yearSection = document.createElement("section");
    yearSection.className = "timeline-year";
    const title = document.createElement("h3");
    title.textContent = y + " 年";
    yearSection.append(title);
    for (const [month, monthPhotos] of months) {
      const section = document.createElement("section");
      section.className = "timeline-month";
      const monthTitle = document.createElement("h4");
      monthTitle.textContent = Number(month) + " 月 · " + monthPhotos.length + " 张";
      const cards = document.createElement("div");
      cards.className = "grid";
      for (const photo of monthPhotos) {
        const index = visiblePhotos.indexOf(photo);
        const card = grid.children[index].cloneNode(true);
        if (photo.milestone) {
          card.classList.add("milestone-card");
          const badge = document.createElement("span");
          badge.className = "milestone-label";
          badge.textContent = "★ 里程碑";
          card.querySelector(".card-copy").append(badge);
        }
        card.querySelector(".photo-button").addEventListener("click", event => openLightbox(index, event.currentTarget));
        cards.append(card);
      }
      section.append(monthTitle, cards);
      yearSection.append(section);
    }
    groups.append(yearSection);
  }
}

for (const [id, mode] of [["wall-view", "wall"], ["timeline-view", "timeline"]]) {
  document.querySelector("#" + id).addEventListener("click", () => {
    viewMode = mode;
    grid.hidden = mode !== "wall";
    document.querySelector("#timeline").hidden = mode !== "timeline";
    document.querySelector("#wall-view").setAttribute("aria-pressed", String(mode === "wall"));
    document.querySelector("#timeline-view").setAttribute("aria-pressed", String(mode === "timeline"));
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("shiguang-album", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("photos", {keyPath: "file"});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("数据库被其他页面占用，请关闭其他相册页面后重试。"));
  });
}

function storePhotos(entries, replace = false) {
  return new Promise((resolve, reject) => {
    if (!database) { reject(new Error("浏览器本地存储不可用")); return; }
    const transaction = database.transaction("photos", "readwrite");
    const store = transaction.objectStore("photos");
    entries.forEach(entry => replace ? store.put(entry) : store.add(entry));
    transaction.oncomplete = () => {
      entries.forEach(entry => storedKeys.add(entry.file.toLowerCase()));
      resolve();
    };
    transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error("本地存储失败"));
  });
}

async function updatePhoto(changes) {
  const photo = visiblePhotos[currentIndex];
  const file = privateFiles.get(photo.file);
  if (!file) return;
  const record = {...photoRecord(photo), ...changes};
  try {
    await storePhotos([{...record, blob: file}], true);
    Object.assign(photo, changes);
    ++exportVersion;
    renderFilters();
    renderGrid();
    currentIndex = visiblePhotos.findIndex(item => item.file === record.file);
    if (currentIndex < 0) lightbox.close();
    else updateLightbox();
  } catch (error) { showError("保存照片信息失败：" + error.message); }
}
document.querySelector("#photo-category").addEventListener("change", event => updatePhoto({category: event.target.value}));
document.querySelector("#milestone").addEventListener("click", () => updatePhoto({milestone: !visiblePhotos[currentIndex].milestone}));

function localDate(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

// Read only JPEG APP1 metadata; malformed or unsupported EXIF is treated as absent.
async function readLocalExif(file) {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 4 || view.getUint16(0) !== 0xffd8) return {};
    let pos = 2;
    while (pos + 4 <= bytes.length) {
      if (bytes[pos++] !== 0xff) break;
      while (pos < bytes.length && bytes[pos] === 0xff) pos++;
      const marker = bytes[pos++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (pos + 2 > bytes.length) break;
      const length = view.getUint16(pos);
      if (length < 2 || pos + length > bytes.length) break;
      const end = pos + length;
      if (marker === 0xe1 && length >= 16 && bytes[pos + 2] === 0x45 && bytes[pos + 3] === 0x78 &&
          bytes[pos + 4] === 0x69 && bytes[pos + 5] === 0x66 && bytes[pos + 6] === 0 && bytes[pos + 7] === 0) {
        const base = pos + 8;
        const order = view.getUint16(base);
        if (order !== 0x4949 && order !== 0x4d4d) return {};
        const le = order === 0x4949;
        const inside = (at, size) => Number.isSafeInteger(at) && at >= base && size >= 0 && at + size <= end;
        const u16 = at => { if (!inside(at, 2)) throw new Error("Invalid EXIF"); return view.getUint16(at, le); };
        const u32 = at => { if (!inside(at, 4)) throw new Error("Invalid EXIF"); return view.getUint32(at, le); };
        if (u16(base + 2) !== 42) return {};
        const entries = offset => {
          const start = base + offset;
          const count = u16(start);
          if (!inside(start + 2, count * 12 + 4)) throw new Error("Invalid IFD");
          const result = new Map();
          for (let i = 0; i < count; i++) {
            const at = start + 2 + i * 12;
            result.set(u16(at), {type: u16(at + 2), count: u32(at + 4), at: at + 8});
          }
          return result;
        };
        const pointer = entry => entry && entry.type === 4 && entry.count === 1 ? u32(entry.at) : 0;
        const dataAt = (entry, size) => {
          const at = size <= 4 ? entry.at : base + u32(entry.at);
          if (!inside(at, size)) throw new Error("Invalid EXIF value");
          return at;
        };
        const ascii = entry => {
          if (!entry || entry.type !== 2 || entry.count > end - base) return "";
          const at = dataAt(entry, entry.count);
          return String.fromCharCode(...bytes.subarray(at, at + Math.min(entry.count, 64))).replace(/\0.*$/, "");
        };
        const root = entries(u32(base + 4));
        const exifOffset = pointer(root.get(0x8769));
        const gpsOffset = pointer(root.get(0x8825));
        const result = {};
        if (exifOffset) {
          const value = ascii(entries(exifOffset).get(0x9003));
          const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
          if (match) {
            const [, y, m, d, h, min, s] = match.map(Number);
            const date = new Date(y, m - 1, d, h, min, s);
            if (y >= 100 && date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d &&
                date.getHours() === h && date.getMinutes() === min && date.getSeconds() === s) result.DateTimeOriginal = date;
          }
        }
        if (gpsOffset) {
          const gps = entries(gpsOffset);
          const coordinate = (tag, refTag, positive, negative, limit) => {
            const entry = gps.get(tag), ref = ascii(gps.get(refTag));
            if (!entry || entry.type !== 5 || entry.count !== 3 || ![positive, negative].includes(ref)) return undefined;
            const at = dataAt(entry, 24);
            const parts = [0, 8, 16].map(i => u32(at + i) / u32(at + i + 4));
            if (!parts.every(Number.isFinite) || parts[1] >= 60 || parts[2] >= 60) return undefined;
            const value = parts[0] + parts[1] / 60 + parts[2] / 3600;
            return value <= limit ? value * (ref === negative ? -1 : 1) : undefined;
          };
          result.latitude = coordinate(2, 1, "N", "S", 90);
          result.longitude = coordinate(4, 3, "E", "W", 180);
        }
        return result;
      }
      pos = end;
    }
  } catch { /* Broken metadata must never prevent importing a readable image. */ }
  return {};
}

async function importBatch(selected) {
  if (importing) return;
  const status = document.querySelector("#batch-status");
  const files = [...selected].filter(file => imageExtensions.test(file.name) && (!file.type || imageTypes.has(file.type)));
  if (!files.length) { status.textContent = "没有找到支持的照片。"; return; }
  if (!database) { status.textContent = "本地数据库不可用，照片未导入。"; return; }
  importing = true;
  const additions = [];
  const reserved = new Set([...storedKeys, ...photos.map(photo => photo.file.toLowerCase())]);
  let failed = 0;
  try {
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      status.textContent = `正在读取 ${index + 1} / ${files.length}…`;
      const metadata = await readLocalExif(file);
      const date = metadata?.DateTimeOriginal instanceof Date && Number.isFinite(metadata.DateTimeOriginal.getTime())
        ? metadata.DateTimeOriginal : new Date(file.lastModified);
      const dateString = localDate(date);
      if (!validDate(dateString)) { failed++; continue; }
      const url = URL.createObjectURL(file);
      let width, height;
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        width = image.naturalWidth;
        height = image.naturalHeight;
      } catch { failed++; continue; }
      finally { URL.revokeObjectURL(url); }
      const screenshot = /截图|screenshot/i.test(file.name) || Math.max(width / height, height / width) >= 3;
      const travelCandidate = Number.isFinite(metadata?.latitude) && Number.isFinite(metadata?.longitude);
      const category = screenshot ? "截图" : travelCandidate ? "旅行" : "生活";
      let path = newPrivatePath(file, category);
      const extension = path.slice(path.lastIndexOf("."));
      const stem = path.slice(0, -extension.length);
      let suffix = 2;
      while (reserved.has(path.toLowerCase())) path = stem + "-" + suffix++ + extension;
      reserved.add(path.toLowerCase());
      additions.push({file:path, title:file.name.replace(/\.[^.]+$/, "") || "未命名", category, tags:[],
        date:dateString, milestone:false, dateSource:metadata?.DateTimeOriginal === date ? "exif" : "modified",
        travelCandidate, blob:file});
    }
    if (!additions.length) { status.textContent = "没有可导入的照片，请检查文件格式。"; return; }
    const records = [...photos.map(photoRecord), ...additions.map(({blob, ...record}) => record)];
    normalizePhotos(records);
    await storePhotos(additions);
    for (const entry of additions) { privateFiles.set(entry.file, entry.blob); storedFiles.set(entry.file, entry.blob); }
    hasLocalManifest = true;
    setPhotos(records);
    const exifCount = additions.filter(entry => entry.dateSource === "exif").length;
    status.textContent = `共导入 ${additions.length} 张，其中 ${exifCount} 张使用拍摄时间，${additions.length - exifCount} 张使用文件时间兜底${failed ? `，${failed} 张无法读取` : ""}。`;
  } catch (error) {
    status.textContent = "导入未完成：" + error.message + "。请检查浏览器存储空间。";
  } finally { importing = false; }
}

for (const [button, input] of [["batch-button", "batch-input"], ["batch-folder-button", "batch-folder"]]) {
  const field = document.querySelector("#" + input);
  document.querySelector("#" + button).addEventListener("click", () => field.click());
  field.addEventListener("change", () => { const files = [...field.files]; field.value = ""; if (files.length) importBatch(files); });
}
const dropZone = document.querySelector("#drop-photos");
dropZone.addEventListener("dragover", event => { event.preventDefault(); dropZone.classList.add("dragging"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragging"));
dropZone.addEventListener("drop", event => {
  event.preventDefault();
  dropZone.classList.remove("dragging");
  importBatch(event.dataTransfer.files);
});

function safeFilePart(value) {
  const cleaned = value.normalize("NFC").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/^[ .]+|[ .]+$/g, "");
  if (!cleaned) return "未命名";
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned)
    ? "_" + cleaned : cleaned;
}

function newPrivatePath(file, category) {
  const dot = file.name.lastIndexOf(".");
  const stem = safeFilePart(file.name.slice(0, dot));
  const extension = file.name.slice(dot);
  const filename = stem + extension;
  const directory = "photos/private/" + safeFilePart(category) + "/";
  const occupied = new Set([...photos.map(photo => photo.file), ...privateFiles.keys(), ...storedKeys]
    .map(path => path.normalize("NFC").toLowerCase()));
  let path = directory + filename;
  let suffix = 2;
  while (occupied.has(path.toLowerCase())) path = directory + stem + "-" + suffix++ + extension;
  return path;
}

document.querySelector("#add-photo").addEventListener("click", () => {
  addForm.reset();
  addFields.disabled = false;
  saveAdd.disabled = false;
  addError.hidden = true;
  addStatus.hidden = true;
  newCategory.value = activeCategory ?? "";
  const suggestions = document.querySelector("#category-options");
  suggestions.replaceChildren();
  for (const category of new Set(photos.map(photo => photo.category))) {
    suggestions.append(new Option(category, category));
  }
  addDialog.showModal();
});
document.querySelector("#cancel-add").addEventListener("click", () => addDialog.close());
addDialog.addEventListener("close", () => {
  ++addVersion;
  addForm.reset();
  addFields.disabled = false;
  saveAdd.disabled = false;
});
newPhoto.addEventListener("change", () => {
  if (!newTitle.value && newPhoto.files[0]) newTitle.value = newPhoto.files[0].name.replace(/\.[^.]+$/, "");
});
addForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!addForm.reportValidity()) return;
  const file = newPhoto.files[0];
  const category = newCategory.value.trim();
  const version = ++addVersion;
  addError.hidden = true;
  try {
    if (!file || !imageExtensions.test(file.name) || (file.type && !imageTypes.has(file.type))) {
      throw new Error("请选择 JPEG、PNG、WebP、GIF、AVIF 或 BMP 照片。");
    }
    const record = {
      file: newPrivatePath(file, category),
      title: newTitle.value.trim(),
      category,
      tags: newTags.value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean),
      date: newDate.value
    };
    const records = [...photos.map(photoRecord), record];
    normalizePhotos(records);
    addFields.disabled = true;
    saveAdd.disabled = true;
    addStatus.textContent = "正在检查照片…";
    addStatus.hidden = false;
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
    } catch {
      throw new Error("这张照片无法解码，请检查文件是否完整或换用支持的图片格式。");
    } finally {
      URL.revokeObjectURL(url);
    }
    if (version !== addVersion || !addDialog.open) return;
    await storePhotos([{...record, milestone:false, dateSource:"unknown", travelCandidate:false, blob:file}]);
    if (version !== addVersion || !addDialog.open) return;
    privateFiles.set(record.file, file);
    storedFiles.set(record.file, file);
    sessionAdditions.set(record.file, file);
    hasLocalManifest = true;
    setPhotos(records);
    ++loadVersion;
    addDialog.close();
    const index = visiblePhotos.findIndex(photo => photo.file === record.file);
    grid.children[index]?.querySelector(".photo-button").focus();
    importStatus.textContent = "照片已加入本次预览。请点击「导出私人存档」，将照片和清单保存到硬盘。";
    importStatus.hidden = false;
  } catch (error) {
    if (version !== addVersion || !addDialog.open) return;
    addError.textContent = error.message;
    addError.hidden = false;
  } finally {
    if (version === addVersion) {
      addFields.disabled = false;
      saveAdd.disabled = false;
      addStatus.hidden = true;
    }
  }
});

// ZIP store mode keeps the selected originals and UTF-8 paths without a network dependency.
const crcTable = Uint32Array.from({length: 256}, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});

async function makeArchive(entries, checkCancelled) {
  const localParts = [];
  const centralParts = [];
  const encoder = new TextEncoder();
  let offset = 0;
  let centralSize = 0;
  if (entries.length > 65535) throw new Error("照片数量超出单个 ZIP 存档的范围，请分批存档。");
  for (const entry of entries) {
    checkCancelled();
    const name = encoder.encode(entry.name);
    if (name.length > 65535 || offset + entry.data.size + name.length + 30 > 0xffffffff) {
      throw new Error("存档超过普通 ZIP 的 4 GB 或文件名长度限制，请分批存档。");
    }
    const crc = await archiveChecksum(entry.data, checkCancelled);
    const local = new Uint8Array(30);
    const header = new DataView(local.buffer);
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 0x0800, true);
    header.setUint16(12, 33, true);
    header.setUint32(14, crc, true);
    header.setUint32(18, entry.data.size, true);
    header.setUint32(22, entry.data.size, true);
    header.setUint16(26, name.length, true);
    const central = new Uint8Array(46);
    const directory = new DataView(central.buffer);
    directory.setUint32(0, 0x02014b50, true);
    directory.setUint16(4, 20, true);
    directory.setUint16(6, 20, true);
    directory.setUint16(8, 0x0800, true);
    directory.setUint16(14, 33, true);
    directory.setUint32(16, crc, true);
    directory.setUint32(20, entry.data.size, true);
    directory.setUint32(24, entry.data.size, true);
    directory.setUint16(28, name.length, true);
    directory.setUint32(42, offset, true);
    localParts.push(local, name, entry.data);
    centralParts.push(central, name);
    offset += local.length + name.length + entry.data.size;
    centralSize += central.length + name.length;
  }
  checkCancelled();
  if (offset + centralSize + 22 > 0xffffffff) throw new Error("存档超过 4 GB，请分批存档。");
  const end = new Uint8Array(22);
  const footer = new DataView(end.buffer);
  footer.setUint32(0, 0x06054b50, true);
  footer.setUint16(8, entries.length, true);
  footer.setUint16(10, entries.length, true);
  footer.setUint32(12, centralSize, true);
  footer.setUint32(16, offset, true);
  return new Blob([...localParts, ...centralParts, end], {type: "application/zip"});
}

async function archiveChecksum(blob, checkCancelled) {
  let crc = 0xffffffff;
  const reader = blob.stream().getReader();
  try {
    while (true) {
      checkCancelled();
      const {done, value} = await reader.read();
      if (done) break;
      for (const byte of value) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function checkArchive(condition, message = "ZIP 结构损坏，请重新选择本相册导出的存档。") {
  if (!condition) throw new Error(message);
}

async function readPrivateArchive(file, checkCancelled) {
  checkArchive(file.size >= 22);
  const tailStart = Math.max(0, file.size - 65557);
  const tail = new DataView(await file.slice(tailStart).arrayBuffer());
  let end = -1;
  for (let offset = tail.byteLength - 22; offset >= 0; offset--) {
    if (tail.getUint32(offset, true) === 0x06054b50 &&
        offset + 22 + tail.getUint16(offset + 20, true) === tail.byteLength) {
      end = offset;
      break;
    }
  }
  checkArchive(end >= 0);
  checkArchive(tail.getUint16(end + 4, true) === 0 && tail.getUint16(end + 6, true) === 0);
  const count = tail.getUint16(end + 10, true);
  const centralSize = tail.getUint32(end + 12, true);
  const centralStart = tail.getUint32(end + 16, true);
  checkArchive(count > 0 && count === tail.getUint16(end + 8, true));
  checkArchive(centralStart + centralSize === tailStart + end);
  const decoder = new TextDecoder("utf-8", {fatal: true});
  const entries = new Map();
  const ranges = [];
  let cursor = centralStart;
  for (let index = 0; index < count; index++) {
    checkCancelled();
    checkArchive(cursor + 46 <= centralStart + centralSize);
    const directory = new DataView(await file.slice(cursor, cursor + 46).arrayBuffer());
    checkArchive(directory.getUint32(0, true) === 0x02014b50);
    const flags = directory.getUint16(8, true);
    checkArchive(directory.getUint16(10, true) === 0 && (flags & ~0x0800) === 0,
      "请选择本相册导出的普通 ZIP 存档；当前导入支持无压缩、无密码的格式。");
    const size = directory.getUint32(24, true);
    checkArchive(size === directory.getUint32(20, true) && size !== 0xffffffff);
    checkArchive(directory.getUint16(34, true) === 0);
    checkArchive(((directory.getUint32(38, true) >>> 16) & 0xf000) !== 0xa000);
    const nameLength = directory.getUint16(28, true);
    const next = cursor + 46 + nameLength + directory.getUint16(30, true) + directory.getUint16(32, true);
    checkArchive(next <= centralStart + centralSize);
    const name = decoder.decode(await file.slice(cursor + 46, cursor + 46 + nameLength).arrayBuffer());
    const parts = name.split("/");
    checkArchive(/^photos\/private\//i.test(name) && parts.every(part =>
      part && part !== "." && part !== ".." && !/[\\:\u0000-\u001f]/.test(part)),
    "存档包含不安全的路径，已拒绝导入。");
    checkArchive(!entries.has(name), "存档包含重复文件路径，已拒绝导入。");
    checkArchive(name === "photos/private/photos.json" || imageExtensions.test(name),
      "私人存档只能包含照片和私人清单。");
    const start = directory.getUint32(42, true);
    checkArchive(start + 30 <= centralStart);
    const header = new DataView(await file.slice(start, start + 30).arrayBuffer());
    const crc = directory.getUint32(16, true);
    checkArchive(header.getUint32(0, true) === 0x04034b50 && header.getUint16(6, true) === flags &&
      header.getUint16(8, true) === 0 && header.getUint32(14, true) === crc &&
      header.getUint32(18, true) === size && header.getUint32(22, true) === size);
    checkArchive(header.getUint16(26, true) === nameLength);
    const dataStart = start + 30 + nameLength + header.getUint16(28, true);
    checkArchive(dataStart + size <= centralStart);
    checkArchive(decoder.decode(await file.slice(start + 30, start + 30 + nameLength).arrayBuffer()) === name);
    const data = file.slice(dataStart, dataStart + size);
    checkArchive(await archiveChecksum(data, checkCancelled) === crc, "存档校验失败，照片或清单可能损坏。");
    entries.set(name, data);
    ranges.push({start, end: dataStart + size});
    cursor = next;
  }
  checkArchive(cursor === centralStart + centralSize);
  ranges.sort((a, b) => a.start - b.start);
  let previousEnd = 0;
  for (const range of ranges) {
    checkArchive(range.start === previousEnd);
    previousEnd = range.end;
  }
  checkArchive(previousEnd === centralStart && entries.has("photos/private/photos.json"));
  const records = JSON.parse((await entries.get("photos/private/photos.json").text()).replace(/^\uFEFF/, ""));
  const normalized = normalizePhotos(records);
  checkArchive(normalized.every(photo => photo.private && imageExtensions.test(photo.file)),
    "存档清单只能引用私人照片。");
  const referenced = new Set(normalized.map(photo => photo.file));
  checkArchive(entries.size === referenced.size + 1 && [...referenced].every(name => entries.has(name)),
    "存档中的照片与清单不一致，已拒绝导入。");
  const types = {jpg:"image/jpeg", jpeg:"image/jpeg", png:"image/png", webp:"image/webp",
    gif:"image/gif", avif:"image/avif", bmp:"image/bmp"};
  const files = new Map([...referenced].map(name => [name,
    new File([entries.get(name)], name.split("/").at(-1), {type: types[name.split(".").at(-1).toLowerCase()]})
  ]));
  checkCancelled();
  return {records, files};
}

document.querySelector("#import-archive").addEventListener("click", () => archiveInput.click());
archiveInput.addEventListener("change", async () => {
  const file = archiveInput.files[0];
  archiveInput.value = "";
  if (!file) return;
  const version = ++loadVersion;
  importStatus.textContent = "正在本机校验并读取 ZIP 存档…";
  importStatus.hidden = false;
  try {
    const restored = await readPrivateArchive(file, () => {
      if (version !== loadVersion) throw new DOMException("导入已取消", "AbortError");
    });
    if (version !== loadVersion) return;
    const existing = new Map(photos.filter(photo => photo.private).map(photo => [photo.file.toLowerCase(), photo]));
    const changes = [];
    const remapped = new Map();
    const reserved = new Set([...existing.keys(), ...storedKeys]);
    for (const record of restored.records) {
      if (remapped.has(record.file)) continue;
      let path = record.file;
      const extension = path.slice(path.lastIndexOf("."));
      const stem = path.slice(0, -extension.length);
      let suffix = 2;
      while (reserved.has(path.toLowerCase())) path = stem + "-" + suffix++ + extension;
      reserved.add(path.toLowerCase());
      remapped.set(record.file, path);
    }
    const imported = restored.records.map(record => ({...record, file:remapped.get(record.file)}));
    for (const record of imported) {
      if (!changes.some(entry => entry.file === record.file)) {
        changes.push({...record, blob:restored.files.get([...remapped].find(([, path]) => path === record.file)[0])});
      }
    }
    await storePhotos(changes);
    if (version !== loadVersion) return;
    ++imageVersion;
    lightbox.close();
    largeImage.removeAttribute("src");
    revokePrivateUrls();
    for (const entry of changes) { privateFiles.set(entry.file, entry.blob); storedFiles.set(entry.file, entry.blob); }
    hasLocalManifest = true;
    setPhotos([...photos.map(photoRecord), ...imported]);
    importStatus.textContent = `已在本机导入 ${imported.length} 张私人照片。`;
    importStatus.hidden = false;
  } catch (error) {
    if (version !== loadVersion) return;
    importStatus.hidden = true;
    showError("存档导入失败：" + error.message);
  }
});

function releaseDownloads() {
  for (const url of downloadUrls) URL.revokeObjectURL(url);
  downloadUrls.clear();
}

exportPrivate.addEventListener("click", async () => {
  if (exportBusy) return;
  const records = photos.filter(photo => photo.private).map(photoRecord);
  if (!records.length) return;
  if (records.some(record => !privateFiles.has(record.file))) {
    showError("请先选择 photos 文件夹，补齐清单中缺少的私人照片。");
    return;
  }
  const entries = [...new Set(records.map(record => record.file))]
    .map(name => ({name, data: privateFiles.get(name)}));
  entries.push({name: "photos/private/photos.json", data: new Blob([JSON.stringify(records, null, 2)], {type: "application/json"})});
  const version = ++exportVersion;
  exportBusy = true;
  updatePrivateStatus();
  importStatus.textContent = "正在本机生成存档包…";
  importStatus.hidden = false;
  try {
    const archive = await makeArchive(entries, () => {
      if (version !== exportVersion) throw new DOMException("存档已取消", "AbortError");
    });
    if (version !== exportVersion) return;
    const url = URL.createObjectURL(archive);
    downloadUrls.add(url);
    const link = document.createElement("a");
    link.href = url;
    const now = new Date();
    const datePart = new Intl.DateTimeFormat("sv-SE").format(now);
    const timePart = [now.getHours(), now.getMinutes(), now.getSeconds()]
      .map(value => String(value).padStart(2, "0")).join("-");
    link.download = `拾光私人相册-${datePart}_${timePart}-${String(now.getMilliseconds()).padStart(3, "0")}.zip`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      downloadUrls.delete(url);
    }, 60000);
    importStatus.textContent = "存档包已生成，请确认下载完成。将包内的 photos 文件夹解压到相册根目录，之后可重新读取清单和照片。存档包包含原图，请妥善保存。";
  } catch (error) {
    if (version !== exportVersion) return;
    showError("存档生成失败：" + error.message);
    importStatus.hidden = true;
  } finally {
    exportBusy = false;
    updatePrivateStatus();
  }
});

async function initialize() {
  let initial = demoPhotos;
  let manifestError = "";
  if (location.protocol !== "file:") {
    try {
      const response = await fetch("./photos.json", {cache:"no-store", credentials:"omit", mode:"same-origin", redirect:"error", referrerPolicy:"no-referrer"});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      initial = await response.json();
      if (normalizePhotos(initial).some(photo => photo.private)) throw new Error("默认清单不能包含私人照片");
    } catch (error) {
      initial = demoPhotos;
      manifestError = "读取默认清单失败：" + error.message;
    }
  }
  try {
    database = await openDatabase();
    database.onversionchange = () => { database.close(); database = null; };
    const saved = await new Promise((resolve, reject) => {
      const transaction = database.transaction("photos", "readonly");
      const request = transaction.objectStore("photos").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    for (const entry of saved) {
      privateFiles.set(entry.file, entry.blob);
      storedFiles.set(entry.file, entry.blob);
      storedKeys.add(entry.file.toLowerCase());
    }
    hasLocalManifest = saved.length > 0;
    setPhotos([...initial, ...saved.map(({blob, ...record}) => record)]);
    if (manifestError) showError(manifestError);
  } catch (error) {
    setPhotos(initial);
    showError("浏览器本地存储不可用：" + error.message + "。批量导入需要本地存储权限。");
  }
}

initialize();
