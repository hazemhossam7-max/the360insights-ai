function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values) {
  return Array.from(
    new Set(
      (values || [])
        .map((item) => cleanText(item))
        .filter(Boolean)
    )
  );
}

function pathFromUrl(value) {
  try {
    return new URL(String(value || "")).pathname || "/";
  } catch {
    return "";
  }
}

function looksLikePersonName(value) {
  const text = cleanText(value);
  if (!text) {
    return false;
  }

  if (!/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4}$/.test(text)) {
    return false;
  }

  const words = text.split(/\s+/);
  const uiTerms = new Set([
    "available",
    "advanced",
    "filter",
    "filters",
    "analysis",
    "insights",
    "directory",
    "dashboard",
    "planner",
    "hub",
    "collections",
    "competitions",
    "training",
    "technical",
    "mental",
    "athletes",
    "athlete",
    "matches",
    "match",
    "rankings",
    "ranking",
    "select",
    "weight",
    "global",
    "featured",
    "recent",
    "reports",
    "report",
  ]);

  return words.every((word) => !uiTerms.has(word.toLowerCase()));
}

function isNoiseLabel(value) {
  const text = cleanText(value);
  const normalized = normalizeKey(text);
  if (!normalized) {
    return true;
  }

  if (normalized.length < 2) {
    return true;
  }

  if (/hazem hosny|sports analytics user|^hh\b/.test(normalized)) {
    return true;
  }

  if (/\b(user|profile|account)\b/.test(normalized) && normalized.split(" ").length >= 3) {
    return true;
  }

  if (looksLikePersonName(text) && !/\b(athlete|analysis|insights|hub|dashboard)\b/i.test(text)) {
    return true;
  }

  return false;
}

function moduleSortKey(moduleSpec) {
  return (moduleSpec.detailWeight || 0) * 100 + (moduleSpec.subfeatures?.length || 0) * 10 + (moduleSpec.pages?.length || 0);
}

function filterMeaningfulLabels(values) {
  return unique(values).filter((item) => !isNoiseLabel(item));
}

function buildCompactPage(page) {
  const title = cleanText(page?.title || "");
  const url = cleanText(page?.url || "");
  return {
    title: title || pathFromUrl(url) || "Page",
    url,
    path: pathFromUrl(url),
    headings: filterMeaningfulLabels(page?.headings).slice(0, 10),
    buttons: filterMeaningfulLabels(page?.buttons).slice(0, 10),
    forms: filterMeaningfulLabels((page?.forms || []).map((form) => form?.summary || "")).slice(0, 8),
    cards: filterMeaningfulLabels(page?.cards).slice(0, 10),
    links: filterMeaningfulLabels((page?.importantLinks || []).map((link) => link?.text || "")).slice(0, 10),
  };
}

function scoreModulePageMatch(moduleKey, page) {
  const titleKey = normalizeKey(page?.title || "");
  const pathKey = normalizeKey(page?.path || "");
  const evidenceItems = [
    ...(page?.headings || []),
    ...(page?.buttons || []),
    ...(page?.forms || []),
    ...(page?.cards || []),
    ...(page?.links || []),
  ];
  const evidenceKey = normalizeKey(evidenceItems.join(" "));

  let score = 0;
  if (titleKey === moduleKey) {
    score += 10;
  } else if (titleKey.includes(moduleKey)) {
    score += 7;
  }

  if (pathKey === moduleKey) {
    score += 8;
  } else if (pathKey.includes(moduleKey)) {
    score += 5;
  }

  if (evidenceKey.includes(moduleKey)) {
    score += 3;
  }

  return score;
}

function pickWindow(items, startIndex, size) {
  const values = unique(items);
  if (!values.length || size <= 0) {
    return [];
  }

  const output = [];
  for (let index = 0; index < Math.min(size, values.length); index += 1) {
    output.push(values[(startIndex + index) % values.length]);
  }

  return output;
}

function buildModuleCatalog(websiteBrief) {
  const pages = Array.isArray(websiteBrief?.pages) ? websiteBrief.pages.map(buildCompactPage) : [];
  const featureCandidates = Array.isArray(websiteBrief?.featureCandidates)
    ? websiteBrief.featureCandidates
    : [];
  const rawModules = filterMeaningfulLabels(websiteBrief?.sidebarModules || []);
  const moduleLabels = rawModules.length
    ? rawModules
    : filterMeaningfulLabels(pages.map((page) => page.title));

  return moduleLabels
    .map((moduleLabel) => {
      const key = normalizeKey(moduleLabel);
      const relatedPages = pages
        .map((page) => ({
          ...page,
          relevanceScore: scoreModulePageMatch(key, page),
        }))
        .filter((page) => page.relevanceScore > 0)
        .sort((a, b) => b.relevanceScore - a.relevanceScore || a.title.localeCompare(b.title));

      const relatedFeatures = featureCandidates
        .filter((item) => {
          const featureLabel = cleanText(item?.feature || item?.label || item?.title || "");
          if (isNoiseLabel(featureLabel)) {
            return false;
          }
          const evidence = Array.isArray(item?.evidence) ? item.evidence.map((value) => cleanText(value)).join(" ") : "";
          const haystack = normalizeKey(`${featureLabel} ${evidence}`);
          return haystack.includes(key) || key.includes(normalizeKey(featureLabel));
        })
        .map((item) => cleanText(item?.feature || item?.label || item?.title || ""));

      const subfeatures = filterMeaningfulLabels([
        ...relatedFeatures,
        ...relatedPages.flatMap((page) => [
          ...(page.headings || []),
          ...(page.buttons || []),
          ...(page.forms || []),
          ...(page.cards || []),
          ...(page.links || []),
        ]),
      ]).filter((item) => normalizeKey(item) !== key);

      const primaryPage = relatedPages[0] || null;
      const route = primaryPage?.path || "";
      const detailWeight = Math.max(1, relatedPages.length * 2 + subfeatures.length);

      return {
        module: moduleLabel,
        moduleKey: key,
        route,
        pages: relatedPages,
        subfeatures,
        detailWeight,
      };
    })
    .sort((a, b) => moduleSortKey(b) - moduleSortKey(a) || a.module.localeCompare(b.module));
}

function distributeCounts(totalCount, items, minimumPerItem = 1) {
  if (!items.length) {
    return [];
  }

  const safeTotal = Math.max(items.length * minimumPerItem, totalCount);
  const base = items.map((item) => ({
    ...item,
    allocated: minimumPerItem,
  }));
  let remaining = safeTotal - items.length * minimumPerItem;
  const totalWeight = base.reduce((sum, item) => sum + Math.max(1, item.weight || 1), 0);

  for (const item of base) {
    if (remaining <= 0) {
      break;
    }
    const share = Math.floor((remaining * Math.max(1, item.weight || 1)) / totalWeight);
    item.allocated += share;
  }

  let assigned = base.reduce((sum, item) => sum + item.allocated, 0);
  let cursor = 0;
  while (assigned < safeTotal) {
    base[cursor % base.length].allocated += 1;
    assigned += 1;
    cursor += 1;
  }

  return base;
}

function buildSharedBatches(websiteBrief, targetCount, batchSize) {
  if (targetCount <= 0) {
    return [];
  }

  const websiteTitle = cleanText(websiteBrief?.title || websiteBrief?.host || websiteBrief?.url || "Website");
  const pages = Array.isArray(websiteBrief?.pages) ? websiteBrief.pages.map(buildCompactPage) : [];
  const notableRoutes = unique((websiteBrief?.notablePaths || []).map((value) => cleanText(value))).slice(0, 12);
  const topModules = filterMeaningfulLabels(websiteBrief?.sidebarModules).slice(0, 12);

  const themes = [
    {
      name: "authenticated shell, landing, and navigation integrity",
      focus: topModules,
    },
    {
      name: "cross-module routing, filters, and result transitions",
      focus: pages.flatMap((page) => page.buttons || []).slice(0, 16),
    },
    {
      name: "system-wide empty states, validation, and recovery behavior",
      focus: pages.flatMap((page) => page.forms || []).slice(0, 12),
    },
    {
      name: "responsive, accessibility, and performance expectations",
      focus: notableRoutes,
    },
  ];

  const batches = [];
  let remaining = targetCount;
  let index = 0;

  for (const theme of themes) {
    if (remaining <= 0) {
      break;
    }

    const currentTarget = Math.min(batchSize, remaining);
    remaining -= currentTarget;
    batches.push({
      batchType: "shared",
      batchLabel: theme.name,
      targetCaseCount: currentTarget,
      maxOutputTokens: Math.max(5000, currentTarget * 320),
      instructions: [
        "You are generating deeply realistic manual website test cases for an authenticated product.",
        "Generate cases only from the visible authenticated evidence in this batch.",
        "Cover cross-module behaviors, shared navigation, filter transitions, state persistence, loading, empty states, permissions, responsiveness, accessibility, and performance where the evidence supports them.",
        "Do not create generic persona permutations.",
        "Do not invent modules or pages not present in the evidence.",
        "Return exactly the requested number of distinct cases.",
      ],
      content: {
        websiteTitle,
        authenticated: true,
        batchFocus: theme.name,
        discoveredModules: topModules,
        notableRoutes,
        focusItems: theme.focus,
        pageSummaries: pages.slice(0, 8).map((page) => ({
          title: page.title,
          path: page.path,
          headings: page.headings.slice(0, 6),
          buttons: page.buttons.slice(0, 6),
          forms: page.forms.slice(0, 4),
        })),
      },
      sortIndex: index,
    });
    index += 1;
  }

  while (remaining > 0) {
    const currentTarget = Math.min(batchSize, remaining);
    remaining -= currentTarget;
    batches.push({
      batchType: "shared",
      batchLabel: "cross-module authenticated regression coverage",
      targetCaseCount: currentTarget,
      maxOutputTokens: Math.max(5000, currentTarget * 320),
      instructions: [
        "Generate additional deep authenticated website test cases from the cross-module evidence below.",
        "Focus on realistic navigation, state persistence, filters, detail drill-down, loading states, and recovery scenarios.",
        "Do not produce repetitive persona permutations.",
        "Return exactly the requested number of distinct cases.",
      ],
      content: {
        websiteTitle,
        authenticated: true,
        batchFocus: "cross-module authenticated regression coverage",
        discoveredModules: topModules,
        notableRoutes,
      },
      sortIndex: index,
    });
    index += 1;
  }

  return batches;
}

export function buildWebsiteOpenAIBatches(websiteBrief, targetCaseCount = 1000, options = {}) {
  const modules = buildModuleCatalog(websiteBrief);
  const safeTarget = Math.max(1, Number(targetCaseCount) || 1);
  const batchSize = Math.max(8, Math.min(24, Number(options.batchSize || 16) || 16));
  const minimumPerModule = modules.length
    ? Math.min(batchSize, Math.max(6, Math.floor(safeTarget / Math.max(1, modules.length * 2))))
    : 0;
  const reservedForModules = Math.min(safeTarget, modules.length * minimumPerModule);
  const maxSharedTarget = Math.max(0, safeTarget - reservedForModules);
  const desiredSharedTarget = Math.round(safeTarget * 0.08);
  const sharedTarget = modules.length
    ? Math.min(
        maxSharedTarget,
        Math.max(
          Math.min(batchSize * 2, maxSharedTarget),
          Math.min(96, desiredSharedTarget)
        )
      )
    : safeTarget;
  const moduleTarget = safeTarget - sharedTarget;
  const moduleAllocations = distributeCounts(
    moduleTarget,
    modules.map((item) => ({
      module: item.module,
      weight: item.detailWeight,
      spec: item,
    })),
    minimumPerModule || 1
  );

  const batches = [];
  let sortIndex = 0;

  for (const allocation of moduleAllocations) {
    const spec = allocation.spec;
    let remaining = allocation.allocated;
    const focusItems = unique([
      ...spec.subfeatures,
      ...spec.pages.flatMap((page) => page.headings || []),
      ...spec.pages.flatMap((page) => page.buttons || []),
      ...spec.pages.flatMap((page) => page.forms || []),
      ...spec.pages.flatMap((page) => page.cards || []),
      ...spec.pages.flatMap((page) => page.links || []),
    ]).slice(0, 36);

    while (remaining > 0) {
      const currentTarget = Math.min(batchSize, remaining);
      remaining -= currentTarget;

      const focusSliceStart = (sortIndex * currentTarget) % Math.max(1, focusItems.length || currentTarget);
      const focusSlice = pickWindow(focusItems, focusSliceStart, Math.min(12, currentTarget));

      batches.push({
        batchType: "module",
        module: spec.module,
        route: spec.route,
        batchLabel: `${spec.module} deep coverage`,
        targetCaseCount: currentTarget,
        maxOutputTokens: Math.max(5000, currentTarget * 320),
        instructions: [
          `Generate deep manual test cases for the authenticated module "${spec.module}".`,
          "Dive into the real visible details of this module, including sub-sections, controls, tables, cards, filters, forms, detail views, empty states, validation, refresh, loading, and navigation where the evidence supports them.",
          "Prefer concrete module behaviors over generic whole-site scenarios.",
          "Do not generate simple persona permutations or shallow duplicates.",
          "Do not invent controls, pages, or submodules not supported by the provided evidence.",
          "Make the cases realistic, distinct, and detailed enough for human QA execution.",
          "Return exactly the requested number of distinct cases.",
        ],
        content: {
          websiteTitle: cleanText(websiteBrief?.title || websiteBrief?.host || websiteBrief?.url || "Website"),
          authenticated: true,
          module: spec.module,
          route: spec.route,
          relatedPages: spec.pages.map((page) => ({
            title: page.title,
            path: page.path,
            headings: page.headings.slice(0, 10),
            buttons: page.buttons.slice(0, 10),
            forms: page.forms.slice(0, 8),
            cards: page.cards.slice(0, 10),
            links: page.links.slice(0, 10),
          })),
          discoveredSubfeatures: spec.subfeatures.slice(0, 24),
          batchFocusItems: focusSlice,
        },
        sortIndex,
      });
      sortIndex += 1;
    }
  }

  batches.push(...buildSharedBatches(websiteBrief, safeTarget - moduleTarget, batchSize).map((item) => ({
    ...item,
    sortIndex: sortIndex + item.sortIndex,
  })));

  return {
    batchSize,
    targetCaseCount: safeTarget,
    modules: modules.map((item) => ({
      module: item.module,
      route: item.route,
      subfeatures: item.subfeatures.length,
      pages: item.pages.length,
      detailWeight: item.detailWeight,
    })),
    batches: batches.sort((a, b) => a.sortIndex - b.sortIndex),
  };
}
