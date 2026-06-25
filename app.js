const state = {
  races: [],
  raceId: "vatternrundan-2026",
  query: "",
  selectedPid: null,
  activeTab: "overview",
  siteTab: "overview",
  resultLimit: 80,
  comparePids: [],
  compareRaceId: null,
  compareQuery: "",
  hideDifficultyYears: true,
};

const els = {
  tabs: document.getElementById("race-tabs"),
  search: document.getElementById("search"),
  results: document.getElementById("results"),
  selected: document.getElementById("selected-view"),
  raceCrumb: document.getElementById("race-crumb"),
  siteNav: document.querySelectorAll("[data-site-tab]"),
};

const FINISH_TIME_CUTOFF_MINUTES = 28.5 * 60;

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[char]);

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hhmm(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return "DNF";
  const rounded = Math.round(minutes);
  return `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
}

function duration(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return "n/a";
  return hhmm(Math.max(0, minutes));
}

function splitTimeText(minutes) {
  return Number.isFinite(minutes) ? hhmm(minutes) : "-";
}

function splitDurationText(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return "-";
  return duration(current - previous);
}

function clockFromAbs(absMinutes) {
  const value = ((Math.round(absMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function countryLabel(code) {
  const clean = String(code || "").trim().toUpperCase();
  if (!clean || clean === "N/A") return "n/a";
  return clean;
}

function countryFlagUrl(code) {
  const clean = countryLabel(code);
  return /^[A-Z]{2}$/.test(clean) ? `https://flagcdn.com/w40/${clean.toLowerCase()}.png` : "";
}

function countryFlagHtml(code, className = "country-flag") {
  const clean = countryLabel(code);
  const flagUrl = countryFlagUrl(clean);
  if (flagUrl) return `<span class="${esc(className)}" title="${esc(clean)}"><img src="${esc(flagUrl)}" alt="${esc(clean)} flag" loading="lazy" decoding="async" onerror="this.style.display='none';this.nextElementSibling.style.display='block'" /><b>${esc(clean)}</b></span>`;
  return `<span class="${esc(className)} country-flag-text" title="${esc(clean)}"><b>${esc(clean)}</b></span>`;
}

function countryWithCodeHtml(code, className = "country-flag-mini") {
  const clean = countryLabel(code);
  return `<span class="country-code-cell">${countryFlagHtml(clean, className)}<span>${esc(clean)}</span></span>`;
}

function tupleToRider(row) {
  return {
    bib: row[0],
    participantId: row[1],
    name: row[2],
    city: row[3],
    country: row[4],
    startClock: row[5],
    finishClock: row[6],
    minutes: row[7],
    finished: row[8],
    isSub9: row[9],
    gender: row[10] || "",
  };
}

function tupleToSplit(row) {
  const checkpointIndex = row[1];
  const elapsedMinutes = checkpointIndex === 0 && row[3] == null ? 0 : row[3];
  return {
    participantId: row[0],
    checkpointIndex,
    absMinutes: row[2],
    elapsedMinutes,
  };
}

function prepareRace(raw) {
  const riders = raw.rows.map(tupleToRider).sort((a, b) => a.bib - b.bib);
  const splits = raw.splits.map(tupleToSplit);
  const ridersByPid = new Map();
  const splitsByPid = new Map();
  const splitsByCheckpoint = new Map();
  const searchIndex = new Map();

  for (const rider of riders) {
    ridersByPid.set(rider.participantId, rider);
    searchIndex.set(
      rider.participantId,
      normalize(`${rider.bib} ${rider.name} ${rider.city} ${rider.country}`),
    );
  }

  for (const split of splits) {
    if (!splitsByPid.has(split.participantId)) splitsByPid.set(split.participantId, []);
    splitsByPid.get(split.participantId).push(split);
    if (!splitsByCheckpoint.has(split.checkpointIndex)) splitsByCheckpoint.set(split.checkpointIndex, []);
    splitsByCheckpoint.get(split.checkpointIndex).push(split);
  }

  for (const list of splitsByPid.values()) list.sort((a, b) => a.checkpointIndex - b.checkpointIndex);
  for (const list of splitsByCheckpoint.values()) list.sort((a, b) => a.absMinutes - b.absMinutes);

  const finishIndex = raw.checkpoints.length - 1;
  for (const rider of riders) {
    const finishSplit = (splitsByPid.get(rider.participantId) || []).find(
      (split) => split.checkpointIndex === finishIndex && split.elapsedMinutes !== null,
    );
    if (finishSplit) {
      rider.minutes = finishSplit.elapsedMinutes;
      rider.finished = true;
    }
  }

  return { ...raw, riders, splits, ridersByPid, splitsByPid, splitsByCheckpoint, searchIndex };
}

function currentRace() {
  return state.races.find((race) => race.id === state.raceId) || state.races[0] || null;
}

function selectedRider(race) {
  return race && state.selectedPid ? race.ridersByPid.get(state.selectedPid) || null : null;
}

function comparisonRiders(race, rider) {
  const finished = race.riders.filter((item) => item.finished && item.minutes !== null);
  if (race.comparison.excludeSub9 && !rider.isSub9) return finished.filter((item) => !item.isSub9);
  return finished;
}

function defaultComparisonRiders(race) {
  const finished = race.riders.filter((item) => item.finished && item.minutes !== null);
  return race.comparison.excludeSub9 ? finished.filter((item) => !item.isSub9) : finished;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function stdDev(values) {
  const avg = mean(values);
  if (avg === null || values.length < 2) return null;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1));
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[index];
}

function statBlock(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return {
    count: sorted.length,
    fastest: sorted[0] ?? null,
    mean: mean(sorted),
    spread: stdDev(sorted),
    q10: percentile(sorted, 0.1),
    q25: percentile(sorted, 0.25),
    median: percentile(sorted, 0.5),
    q75: percentile(sorted, 0.75),
    q90: percentile(sorted, 0.9),
  };
}

function searchRiders(race, query) {
  if (!race) return [];
  const cleaned = normalize(query);
  if (!cleaned) return [];
  const numeric = /^\d+$/.test(cleaned);
  return race.riders
    .map((rider) => {
      const index = race.searchIndex.get(rider.participantId) || "";
      const bib = String(rider.bib);
      let score = 0;
      if (numeric && bib === cleaned) score = 1000;
      else if (numeric && bib.startsWith(cleaned)) score = 800 - Math.abs(bib.length - cleaned.length);
      else if (normalize(rider.name) === cleaned) score = 700;
      else if (normalize(rider.name).startsWith(cleaned)) score = 650;
      else if (index.includes(cleaned)) score = 500;
      return { rider, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.rider.bib - b.rider.bib)
    .slice(0, 12)
    .map((item) => item.rider);
}

function isDepartureCheckpoint(race, checkpointIndex) {
  if (!race) return false;
  return (race.checkpoints[checkpointIndex] || "").toLowerCase().includes("avfärd");
}

function isArrivalCheckpoint(race, checkpointIndex) {
  if (!race) return false;
  return (race.checkpoints[checkpointIndex] || "").toLowerCase().includes("ankomst");
}

function isRankCheckpoint(race, checkpointIndex) {
  if (!race) return false;
  return checkpointIndex > 0 && !isArrivalCheckpoint(race, checkpointIndex);
}

function rankSequenceSplits(race, rider, { includeStart = false } = {}) {
  const splits = race.splitsByPid.get(rider.participantId) || [];
  return splits.filter(
    (split) => (includeStart && split.checkpointIndex === 0) || isRankCheckpoint(race, split.checkpointIndex),
  );
}

function checkpointBaseName(name) {
  return String(name || "")
    .replace(/\s+(ankomst|avfärd)$/i, "")
    .trim();
}

function buildEvolution(race, rider) {
  const mySplits = rankSequenceSplits(race, rider, { includeStart: true });
  if (!mySplits || mySplits.length < 2) return null;

  const startByPid = new Map();
  const finishByPid = new Map();
  const finishIndex = race.checkpoints.length - 1;
  for (const split of race.splits) {
    if (split.checkpointIndex === 0) {
      const prev = startByPid.get(split.participantId);
      if (prev === undefined || split.absMinutes < prev) startByPid.set(split.participantId, split.absMinutes);
    }
    if (split.checkpointIndex === finishIndex) {
      const prev = finishByPid.get(split.participantId);
      if (prev === undefined || split.absMinutes < prev) finishByPid.set(split.participantId, split.absMinutes);
    }
  }

  const myStart = mySplits[0].absMinutes;
  const myFinish = mySplits[mySplits.length - 1].absMinutes;
  const positions = mySplits.map((my) => {
    const active = new Set();
    for (const [pid, start] of startByPid) {
      if (start <= my.absMinutes) {
        const finish = finishByPid.get(pid);
        if (finish === undefined || finish >= my.absMinutes) active.add(pid);
      }
    }
    const checkpointRows = race.splitsByCheckpoint.get(my.checkpointIndex) || [];
    const before = checkpointRows.filter((split) => active.has(split.participantId) && split.absMinutes < my.absMinutes);
    const same = checkpointRows.filter((split) => active.has(split.participantId) && split.absMinutes === my.absMinutes);
    return {
      checkpointIndex: my.checkpointIndex,
      place: race.checkpoints[my.checkpointIndex],
      clock: clockFromAbs(my.absMinutes),
      elapsed: hhmm(my.elapsedMinutes),
      elapsedMinutes: my.elapsedMinutes,
      absMinutes: my.absMinutes,
      position: before.length + 1,
      field: active.size,
      sameMinute: Math.max(0, same.length - 1),
    };
  });

  const myTimes = new Map(mySplits.map((split) => [split.checkpointIndex, split.absMinutes]));
  const myIndexes = mySplits.map((split) => split.checkpointIndex).sort((a, b) => a - b);
  const segmentCounts = new Map();
  const youSet = new Set();
  const themSet = new Set();
  let relevantPeople = 0;

  for (const [pid, splits] of race.splitsByPid) {
    if (pid === rider.participantId) continue;
    const times = new Map();
    for (const split of splits) {
      if (myTimes.has(split.checkpointIndex)) times.set(split.checkpointIndex, split.absMinutes);
    }
    const common = myIndexes.filter((index) => times.has(index));
    if (common.length < 2) continue;
    if (!common.some((index) => times.get(index) >= myStart && times.get(index) <= myFinish)) continue;

    relevantPeople += 1;
    for (let i = 0; i < myIndexes.length - 1; i += 1) {
      const previous = myIndexes[i];
      const current = myIndexes[i + 1];
      if (!times.has(previous) || !times.has(current)) continue;
      const previousDelta = times.get(previous) - myTimes.get(previous);
      const currentDelta = times.get(current) - myTimes.get(current);
      const previousRelation = previousDelta < 0 ? -1 : previousDelta > 0 ? 1 : 0;
      const currentRelation = currentDelta < 0 ? -1 : currentDelta > 0 ? 1 : 0;
      if (previousRelation === 0 || currentRelation === 0 || previousRelation === currentRelation) continue;

      const label = `${race.checkpoints[previous]} -> ${race.checkpoints[current]}`;
      const counts = segmentCounts.get(label) || { you: 0, them: 0 };
      if (previousRelation < 0 && currentRelation > 0) {
        counts.you += 1;
        youSet.add(pid);
      } else {
        counts.them += 1;
        themSet.add(pid);
      }
      segmentCounts.set(label, counts);
    }
  }

  return {
    positions,
    segments: Array.from(segmentCounts.entries()).map(([label, value]) => ({ label, you: value.you, them: value.them })),
    relevantPeople,
    youOvertook: youSet.size,
    theyOvertook: themSet.size,
    netOvertakes: youSet.size - themSet.size,
    startPosition: positions[0]?.position ?? null,
    finishPosition: positions.at(-1)?.position ?? null,
  };
}

function comparisonFieldForCheckpointRank(race, rider) {
  const field = rider?.finished ? comparisonRiders(race, rider) : race.riders;
  return new Set(field.map((item) => item.participantId));
}

function officialTimePositionForSplit(race, rider, split) {
  if (!isRankCheckpoint(race, split.checkpointIndex)) {
    return {
      position: null,
      field: 0,
    };
  }
  const field = comparisonFieldForCheckpointRank(race, rider);
  const finishIndex = race.checkpoints.length - 1;
  if (split.checkpointIndex === finishIndex && rider.finished && rider.minutes !== null) {
    const finishers = comparisonRiders(race, rider).sort((a, b) => a.minutes - b.minutes || a.bib - b.bib);
    const position = finishers.findIndex((item) => item.participantId === rider.participantId);
    return {
      position: position >= 0 ? position + 1 : null,
      field: finishers.length,
    };
  }
  const checkpointRows = (race.splitsByCheckpoint.get(split.checkpointIndex) || [])
    .filter((item) => field.has(item.participantId))
    .sort((a, b) => {
      const riderA = race.ridersByPid.get(a.participantId);
      const riderB = race.ridersByPid.get(b.participantId);
      return a.elapsedMinutes - b.elapsedMinutes || (riderA?.bib ?? a.participantId) - (riderB?.bib ?? b.participantId);
    });
  const position = checkpointRows.findIndex((item) => item.participantId === split.participantId);
  return {
    position: position >= 0 ? position + 1 : null,
    field: checkpointRows.length,
  };
}

function buildOfficialTimeEvolution(race, rider) {
  const rawSplits = race.splitsByPid.get(rider.participantId);
  const mySplits = rankSequenceSplits(race, rider, { includeStart: true });
  if (!rawSplits || !mySplits || mySplits.length < 2) return null;
  const positions = mySplits.map((my) => {
    const ranking = officialTimePositionForSplit(race, rider, my);
    return {
      checkpointIndex: my.checkpointIndex,
      place: race.checkpoints[my.checkpointIndex],
      clock: clockFromAbs(my.absMinutes),
      elapsed: hhmm(my.elapsedMinutes),
      elapsedMinutes: my.elapsedMinutes,
      absMinutes: my.absMinutes,
      position: ranking.position,
      field: ranking.field,
      noPlot: ranking.position === null,
      sameMinute: 0,
    };
  });
  return {
    positions,
    segments: [],
    relevantPeople: race.splitsByPid.size - 1,
    youOvertook: null,
    theyOvertook: null,
    netOvertakes: null,
    startPosition: positions[0]?.position ?? null,
    finishPosition: positions.at(-1)?.position ?? null,
  };
}

function histogramSvg(values, markers, binMinutes = 15) {
  const raw = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!raw.length) return '<div class="empty-state">No finish-time data.</div>';
  const binWidth = Math.max(5, Number(binMinutes) || 15);
  const min = Math.floor((raw[0] - binWidth) / binWidth) * binWidth;
  const rawMax = raw[raw.length - 1];
  let max = Math.min(FINISH_TIME_CUTOFF_MINUTES, Math.ceil((rawMax + binWidth) / binWidth) * binWidth);
  if (max <= min) max = min + binWidth;
  const binCount = Math.max(1, Math.ceil((max - min) / binWidth));
  const bins = Array.from({ length: binCount }, () => 0);
  for (const value of raw) {
    const clipped = Math.min(value, max);
    const index = Math.max(0, Math.min(binCount - 1, Math.floor((clipped - min) / binWidth)));
    bins[index] += 1;
  }
  const maxCount = Math.max(...bins, 1);
  const width = 980;
  const height = 360;
  const left = 58;
  const right = 28;
  const top = 28;
  const bottom = 46;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const xFor = (value) => left + ((value - min) / (max - min)) * chartWidth;
  const yFor = (value) => top + chartHeight - (value / maxCount) * chartHeight;

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((tick) => {
      const y = top + chartHeight * tick;
      return `<line x1="${left}" x2="${width - right}" y1="${y}" y2="${y}" class="grid" /><text x="${left - 12}" y="${y + 5}" text-anchor="end" class="axis">${Math.round(maxCount * (1 - tick))}</text>`;
    })
    .join("");
  const bars = bins
    .map((count, index) => {
      const x = left + (index / binCount) * chartWidth;
      const barWidth = Math.max(2, chartWidth / binCount - 2);
      const y = yFor(count);
      const from = min + index * binWidth;
      const to = from + binWidth;
      const isLast = index === binCount - 1 && rawMax > max;
      const range = `${hhmm(from)}-${hhmm(Math.min(to, max))}${isLast ? "+" : ""}`;
      return `<rect x="${x}" y="${y}" width="${barWidth}" height="${top + chartHeight - y}" rx="1" tabindex="0" class="hist-bar" data-hist-range="${range}" data-hist-count="${count}" data-hist-share="${((count / raw.length) * 100).toFixed(1)}"><title>${range}: ${count} riders</title></rect>`;
    })
    .join("");
  const markerSvg = markers
    .filter((marker) => marker.value !== null && Number.isFinite(marker.value))
    .map((marker) => {
      const x = xFor(Math.min(marker.value, max));
      return `<line x1="${x}" x2="${x}" y1="${top}" y2="${top + chartHeight}" stroke="${marker.color}" stroke-width="3" />`;
    })
    .join("");
  const legend = markers
    .filter((marker) => marker.value !== null && Number.isFinite(marker.value))
    .map((marker, index) => {
      const y = top + 16 + index * 24;
      return `<rect x="${width - 220}" y="${y - 11}" width="11" height="11" fill="${marker.color}" /><text x="${width - 202}" y="${y}" class="axis">${esc(marker.label)} ${hhmm(marker.value)}</text>`;
    })
    .join("");
  const ticks = [min, min + (max - min) / 4, min + (max - min) / 2, min + ((max - min) * 3) / 4, max]
    .map((tick) => `<text x="${xFor(tick)}" y="${height - 14}" text-anchor="middle" class="axis">${hhmm(tick)}</text>`)
    .join("");

  return `<div class="interactive-chart" data-histogram><svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Finish time histogram">${grid}${bars}${markerSvg}${legend}<line x1="${left}" x2="${width - right}" y1="${top + chartHeight}" y2="${top + chartHeight}" class="axis-line" />${ticks}</svg><div class="chart-readout"><strong>15-minute brackets</strong><span>Hover or tap a bar to see how many people finished there. Finish-time axis is capped at ${hhmm(FINISH_TIME_CUTOFF_MINUTES)}.</span></div></div>`;
}

function genderedHistogramSvg(riders, markers, binMinutes = 15) {
  const entries = riders
    .filter((rider) => rider && Number.isFinite(rider.minutes))
    .map((rider) => ({ value: rider.minutes, gender: rider.gender === "F" || rider.gender === "M" ? rider.gender : "U" }))
    .sort((a, b) => a.value - b.value);
  if (!entries.length) return '<div class="empty-state">No finish-time data.</div>';
  const binWidth = Math.max(5, Number(binMinutes) || 15);
  const min = Math.floor((entries[0].value - binWidth) / binWidth) * binWidth;
  const rawMax = entries[entries.length - 1].value;
  let max = Math.min(FINISH_TIME_CUTOFF_MINUTES, Math.ceil((rawMax + binWidth) / binWidth) * binWidth);
  if (max <= min) max = min + binWidth;
  const binCount = Math.max(1, Math.ceil((max - min) / binWidth));
  const bins = Array.from({ length: binCount }, () => ({ M: 0, F: 0, U: 0, total: 0 }));
  for (const entry of entries) {
    const clipped = Math.min(entry.value, max);
    const index = Math.max(0, Math.min(binCount - 1, Math.floor((clipped - min) / binWidth)));
    bins[index][entry.gender] += 1;
    bins[index].total += 1;
  }
  const maxCount = Math.max(...bins.map((bin) => bin.total), 1);
  const hasGender = bins.some((bin) => bin.M || bin.F);
  const hasUnknown = bins.some((bin) => bin.U);
  const width = 980;
  const height = 360;
  const left = 58;
  const right = 28;
  const top = 28;
  const bottom = 46;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const xFor = (value) => left + ((value - min) / (max - min)) * chartWidth;
  const yFor = (value) => top + chartHeight - (value / maxCount) * chartHeight;
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((tick) => {
      const y = top + chartHeight * tick;
      return `<line x1="${left}" x2="${width - right}" y1="${y}" y2="${y}" class="grid" /><text x="${left - 12}" y="${y + 5}" text-anchor="end" class="axis">${Math.round(maxCount * (1 - tick))}</text>`;
    })
    .join("");
  const bars = bins
    .map((bin, index) => {
      const x = left + (index / binCount) * chartWidth;
      const barWidth = Math.max(2, chartWidth / binCount - 2);
      const from = min + index * binWidth;
      const to = from + binWidth;
      const isLast = index === binCount - 1 && rawMax > max;
      const range = `${hhmm(from)}-${hhmm(Math.min(to, max))}${isLast ? "+" : ""}`;
      let stacked = "";
      let base = top + chartHeight;
      for (const [gender, cls] of [
        ["M", "hist-men"],
        ["F", "hist-women"],
        ["U", "hist-unknown"],
      ]) {
        const count = bin[gender];
        if (!count) continue;
        const h = (count / maxCount) * chartHeight;
        base -= h;
        stacked += `<rect x="${x}" y="${base}" width="${barWidth}" height="${h}" rx="1" class="${cls}"><title>${range}: ${count} ${gender === "M" ? "men" : gender === "F" ? "women" : "unknown"}</title></rect>`;
      }
      return `${stacked}<rect x="${x}" y="${yFor(bin.total)}" width="${barWidth}" height="${top + chartHeight - yFor(bin.total)}" rx="1" tabindex="0" class="hist-hit" data-hist-range="${range}" data-hist-count="${bin.total}" data-hist-men="${bin.M}" data-hist-women="${bin.F}" data-hist-unknown="${bin.U}" data-hist-share="${((bin.total / entries.length) * 100).toFixed(1)}"><title>${range}: ${bin.total} riders</title></rect>`;
    })
    .join("");
  const markerSvg = markers
    .filter((marker) => marker.value !== null && Number.isFinite(marker.value))
    .map((marker) => {
      const x = xFor(Math.min(marker.value, max));
      return `<line x1="${x}" x2="${x}" y1="${top}" y2="${top + chartHeight}" stroke="${marker.color}" stroke-width="3" />`;
    })
    .join("");
  const markerLegend = markers
    .filter((marker) => marker.value !== null && Number.isFinite(marker.value))
    .map((marker, index) => {
      const y = top + 16 + index * 22;
      return `<rect x="${width - 220}" y="${y - 10}" width="10" height="10" fill="${marker.color}" /><text x="${width - 204}" y="${y}" class="axis">${esc(marker.label)} ${hhmm(marker.value)}</text>`;
    })
    .join("");
  const genderLegend = `<rect x="${width - 220}" y="${height - 86}" width="10" height="10" class="hist-men" /><text x="${width - 204}" y="${height - 76}" class="axis">Men</text><rect x="${width - 156}" y="${height - 86}" width="10" height="10" class="hist-women" /><text x="${width - 140}" y="${height - 76}" class="axis">Women</text>${hasUnknown ? `<rect x="${width - 70}" y="${height - 86}" width="10" height="10" class="hist-unknown" /><text x="${width - 54}" y="${height - 76}" class="axis">Unknown</text>` : ""}`;
  const ticks = [min, min + (max - min) / 4, min + (max - min) / 2, min + ((max - min) * 3) / 4, max]
    .map((tick) => `<text x="${xFor(tick)}" y="${height - 14}" text-anchor="middle" class="axis">${hhmm(tick)}</text>`)
    .join("");
  const hint = hasGender
    ? "Hover or tap a bar to see men/women counts."
    : "Gender cache is not loaded yet; bars show total finishers.";
  return `<div class="interactive-chart" data-histogram><svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Finish time histogram by gender">${grid}${bars}${markerSvg}${markerLegend}${genderLegend}<line x1="${left}" x2="${width - right}" y1="${top + chartHeight}" y2="${top + chartHeight}" class="axis-line" />${ticks}</svg><div class="chart-readout"><strong>15-minute brackets</strong><span>${esc(hint)} Axis capped at ${hhmm(FINISH_TIME_CUTOFF_MINUTES)}.</span></div></div>`;
}

function bindHistogramInteractions() {
  document.querySelectorAll("[data-histogram]").forEach((chart) => {
    const readout = chart.querySelector(".chart-readout");
    chart.querySelectorAll("[data-hist-range]").forEach((bar) => {
      const activate = () => {
        chart.querySelectorAll(".hist-bar.active, .hist-hit.active").forEach((item) => item.classList.remove("active"));
        bar.classList.add("active");
        const genderParts = [];
        if (bar.dataset.histMen !== undefined) genderParts.push(`${Number(bar.dataset.histMen).toLocaleString()} men`);
        if (bar.dataset.histWomen !== undefined) genderParts.push(`${Number(bar.dataset.histWomen).toLocaleString()} women`);
        if (bar.dataset.histUnknown !== undefined && Number(bar.dataset.histUnknown)) genderParts.push(`${Number(bar.dataset.histUnknown).toLocaleString()} unknown`);
        const detail = genderParts.length ? ` · ${genderParts.join(" · ")}` : "";
        readout.innerHTML = `<strong>${esc(bar.dataset.histRange)}</strong><span>${Number(bar.dataset.histCount).toLocaleString()} people${detail} · ${esc(bar.dataset.histShare)}% of this field</span>`;
      };
      bar.addEventListener("mouseenter", activate);
      bar.addEventListener("focus", activate);
      bar.addEventListener("click", activate);
    });
  });
}

function bindColumnTooltips() {
  let tip = document.querySelector(".column-tooltip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "column-tooltip";
    document.body.appendChild(tip);
  }
  const hide = () => tip.classList.remove("visible");
  const placeTip = (target) => {
    const rect = target.getBoundingClientRect();
    tip.style.maxWidth = `${Math.min(340, window.innerWidth - 24)}px`;
    const top = Math.max(12, rect.top - tip.offsetHeight - 10);
    const left = Math.min(window.innerWidth - tip.offsetWidth - 12, Math.max(12, rect.left + rect.width / 2 - tip.offsetWidth / 2));
    tip.style.top = `${top}px`;
    tip.style.left = `${left}px`;
  };
  document.querySelectorAll("[data-tip]").forEach((target) => {
    const show = () => {
      tip.textContent = target.dataset.tip || "";
      tip.classList.add("visible");
      requestAnimationFrame(() => placeTip(target));
    };
    target.addEventListener("mouseenter", show);
    target.addEventListener("mousemove", () => placeTip(target));
    target.addEventListener("mouseleave", hide);
    target.addEventListener("focus", show);
    target.addEventListener("blur", hide);
    target.addEventListener("click", show);
  });
}

function splitCheckpointLabel(label) {
  const text = String(label || "");
  if (text.length <= 11) return [text];
  const checkpointMatch = text.match(/^(.*)\s+(ankomst|avfärd|förvarning)$/i);
  if (checkpointMatch) return [checkpointMatch[1], checkpointMatch[2]];
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 1) return [words.slice(0, -1).join(" "), words.at(-1)];
  return [text];
}

function evolutionSvg(evolution, options = {}) {
  if (!evolution || !evolution.positions.length) {
    return '<div class="empty-state">Checkpoint evolution is not available for this rider.</div>';
  }
  const plotPositions = evolution.positions.filter((point) => !point.noPlot && Number.isFinite(point.position) && point.position > 0);
  if (!plotPositions.length) {
    return '<div class="empty-state">Checkpoint evolution is not available for this rider.</div>';
  }
  const large = Boolean(options.large);
  const width = large ? 1120 : 980;
  const height = large ? 570 : 410;
  const left = large ? 90 : 62;
  const right = large ? 72 : 24;
  const top = large ? 42 : 34;
  const bottom = large ? 150 : 96;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const maxPosition = Math.max(...plotPositions.map((point) => point.position), 1);
  const xFor = (index) => left + (chartWidth * index) / Math.max(1, plotPositions.length - 1);
  const yFor = (value) => top + (value / maxPosition) * chartHeight;
  const path = plotPositions
    .map((point, index) => `${index === 0 ? "M" : "L"} ${xFor(index)} ${yFor(point.position)}`)
    .join(" ");
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((tick) => {
      const y = top + chartHeight * tick;
      return `<line x1="${left}" x2="${width - right}" y1="${y}" y2="${y}" class="grid" /><text x="${left - 12}" y="${y + 5}" text-anchor="end" class="axis">${Math.round(maxPosition * tick)}</text>`;
    })
    .join("");
  const points = plotPositions
    .map((point, index) => {
      const x = xFor(index);
      const y = yFor(point.position);
      const labelX = index === 0 ? x + 24 : index === plotPositions.length - 1 ? x - 24 : x;
      const dense = plotPositions.length > 6;
      const labelY = height - (dense ? 76 : 56);
      const labelLines = splitCheckpointLabel(point.place);
      const checkpointLabel = `<text x="${x}" y="${labelY}" text-anchor="middle" class="axis checkpoint-label">${labelLines
        .map((line, lineIndex) => `<tspan x="${x}" dy="${lineIndex === 0 ? 0 : 15}">${esc(line)}</tspan>`)
        .join("")}</text>`;
      return `<circle cx="${x}" cy="${y}" r="6" class="evolution-dot" /><text x="${labelX}" y="${y - 14}" text-anchor="middle" class="marker-blue">${point.position}</text>${checkpointLabel}`;
    })
    .join("");
  const bars = evolution.segments
    .map((segment) => {
      const max = Math.max(segment.you, segment.them, 1);
      return `<div class="segment"><span>${esc(segment.label)}</span><div class="bar-row"><i class="bar-positive" style="width:${(segment.you / max) * 100}%"></i><b>${segment.you}</b></div><div class="bar-row"><i class="bar-negative" style="width:${(segment.them / max) * 100}%"></i><b>${segment.them}</b></div></div>`;
    })
    .join("");
  const side =
    bars ||
    `<div class="evolution-note"><strong>${esc(options.noteTitle || "Absolute checkpoint order")}</strong><span>${esc(options.note || "This line ranks every rider who reached each timing mat by actual clock passage time.")}</span></div>`;
  return `<div class="evolution-grid ${large ? "evolution-grid-wide" : ""}"><svg class="chart ${large ? "absolute-evolution-chart" : ""}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(options.label || "Race evolution")}">${grid}<path d="${path}" fill="none" class="evolution-line" />${points}</svg><div class="segment-bars">${side}</div></div>`;
}

function overtakeBars(evolution) {
  if (!evolution || !evolution.segments.length) {
    return '<div class="empty-state">No timing-mat overtake detail is available for this rider.</div>';
  }
  const max = Math.max(...evolution.segments.flatMap((segment) => [segment.you, segment.them]), 1);
  const rows = evolution.segments
    .map((segment) => {
      const net = segment.you - segment.them;
      return `<div class="overtake-row">
        <span>${esc(segment.label)}</span>
        <div class="overtake-bars-pair">
          <i class="bar-positive" style="width:${Math.max(2, (segment.you / max) * 100)}%"></i>
          <i class="bar-negative" style="width:${Math.max(2, (segment.them / max) * 100)}%"></i>
        </div>
        <strong>${coloredCountHtml(segment.you, "positive")} / ${coloredCountHtml(segment.them, "negative")}</strong>
        <em>${signedValueHtml(net, 1)}</em>
      </div>`;
    })
    .join("");
  return `<div class="overtake-panel">
    <div class="overtake-legend"><span><i class="bar-positive"></i> You overtook</span><span><i class="bar-negative"></i> Passed you</span><strong>net</strong></div>
    ${rows}
  </div>`;
}

function countryRows(race, rider) {
  const map = new Map();
  for (const item of race.riders) {
    const key = item.country || "n/a";
    const row = map.get(key) || { country: key, entries: 0, finishers: 0, total: 0 };
    row.entries += 1;
    if (item.finished && item.minutes !== null) {
      row.finishers += 1;
      row.total += item.minutes;
    }
    map.set(key, row);
  }
  const rows = Array.from(map.values()).sort((a, b) => b.entries - a.entries || a.country.localeCompare(b.country));
  const selectedCountry = rows.find((row) => row.country === rider.country);
  const top = rows.slice(0, 10);
  if (selectedCountry && !top.includes(selectedCountry)) top.push(selectedCountry);
  return top;
}

function sortSegments(race, evolution) {
  if (!evolution) return null;
  const order = new Map();
  const indexes = race.checkpoints
    .map((_, index) => index)
    .filter((index) => index === 0 || isRankCheckpoint(race, index));
  for (let index = 0; index < indexes.length - 1; index += 1) {
    order.set(`${race.checkpoints[indexes[index]]} -> ${race.checkpoints[indexes[index + 1]]}`, index);
  }
  return {
    ...evolution,
    segments: [...evolution.segments].sort((a, b) => (order.get(a.label) ?? 999) - (order.get(b.label) ?? 999)),
  };
}

function selectedUrl(race, rider) {
  const url = new URL(window.location.href);
  url.searchParams.set("race", race.id);
  url.searchParams.set("bib", String(rider.bib));
  return url.toString();
}

async function copyToClipboard(text, button, label = "Copied") {
  await navigator.clipboard.writeText(text);
  const original = button.textContent;
  button.textContent = label;
  setTimeout(() => {
    button.textContent = original;
  }, 1400);
}

async function downloadPageScreenshot(button) {
  const target = document.querySelector("#selected-view");
  if (!target) return;
  const original = button.textContent;
  button.textContent = "Rendering...";
  try {
    const rect = target.getBoundingClientRect();
    const width = Math.max(720, Math.ceil(rect.width));
    const height = Math.max(720, Math.ceil(target.scrollHeight || rect.height));
    const scale = Math.min(2, 15000 / Math.max(width, height));
    const clone = target.cloneNode(true);
    clone.querySelectorAll("button, input").forEach((item) => {
      if (item.tagName === "INPUT") item.setAttribute("value", item.value || item.getAttribute("value") || "");
      else item.remove();
    });
    const styles = Array.from(document.styleSheets)
      .map((sheet) => {
        try {
          return Array.from(sheet.cssRules).map((rule) => rule.cssText).join("\n");
        } catch (_error) {
          return "";
        }
      })
      .join("\n");
    const html = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;min-height:${height}px;background:#fff;padding:1px 0 24px">${`<style>${styles}</style>`}${clone.outerHTML}</div></foreignObject></svg>`;
    const blob = new Blob([html], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(image, 0, 0);
    URL.revokeObjectURL(url);
    const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 0.92));
    const link = document.createElement("a");
    link.href = URL.createObjectURL(png);
    link.download = `vatternrundan-${state.raceId}-${state.siteTab}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    button.textContent = "Saved";
  } catch (_error) {
    button.textContent = "Use browser screenshot";
  }
  setTimeout(() => {
    button.textContent = original;
  }, 1600);
}

function dashboardTabs() {
  const tabs = [
    ["overview", "Overview"],
    ["analytics", "Race analytics"],
    ["evolution", "Race evolution"],
    ["distribution", "Distribution"],
    ["dnf", "DNF"],
    ["field", "Field"],
    ["share", "Share"],
  ];
  return `<div class="dashboard-tabs">${tabs
    .map(
      ([id, label]) =>
        `<button type="button" class="${state.activeTab === id ? "active" : ""}" data-dashboard-tab="${id}">${label}</button>`,
    )
    .join("")}</div>`;
}

function checkpointTable(evolution) {
  if (!evolution) return '<div class="empty-state">Checkpoint detail is not available.</div>';
  return `<table class="data-table"><thead><tr><th>Checkpoint</th><th>Clock</th><th>Elapsed</th><th>Position</th><th>Field</th></tr></thead><tbody>${evolution.positions
    .map(
      (point) =>
        `<tr><td>${esc(point.place)}</td><td>${esc(point.clock)}</td><td>${esc(point.elapsed)}</td><td>${point.position.toLocaleString()}</td><td>${point.field.toLocaleString()}</td></tr>`,
    )
    .join("")}</tbody></table>`;
}

function signedValueHtml(value, index, { invert = false } = {}) {
  if (index === 0 || value === null || value === undefined || !Number.isFinite(value)) return '<span class="delta-neutral">-</span>';
  const signed = invert ? -value : value;
  if (signed > 0) return `<span class="delta-positive">+${signed.toLocaleString()}</span>`;
  if (signed < 0) return `<span class="delta-negative">-${Math.abs(signed).toLocaleString()}</span>`;
  return '<span class="delta-neutral">0</span>';
}

function coloredCountHtml(value, tone) {
  const numeric = Number(value);
  const className = tone === "negative" ? "delta-negative" : tone === "neutral" ? "delta-neutral" : "delta-positive";
  return `<span class="${className}">${Number.isFinite(numeric) ? numeric.toLocaleString() : "-"}</span>`;
}

function helpHeader(label, tip) {
  return `<th><span class="column-help" tabindex="0" data-tip="${esc(tip)}">${esc(label)}</span></th>`;
}

function splitTimesTable(evolution, officialTimeEvolution = null, race = null, rider = null) {
  if (!evolution) return '<div class="empty-state">Split times are not available.</div>';
  const kms = race ? checkpointKms(race) : [];
  const officialByCheckpoint = new Map((officialTimeEvolution?.positions || []).map((point) => [point.checkpointIndex, point]));
  const officialPositions = officialTimeEvolution?.positions || [];
  const segmentByLabel = new Map((evolution.segments || []).map((segment) => [segment.label, segment]));
  const rawSplits = race && rider ? race.splitsByPid.get(rider.participantId) || [] : [];
  const rawByCheckpoint = new Map(rawSplits.map((split) => [split.checkpointIndex, split]));
  const shouldShowMissingArrival = (checkpointIndex) => {
    if (!race || !isArrivalCheckpoint(race, checkpointIndex) || rawByCheckpoint.has(checkpointIndex)) return false;
    const arrivalBase = checkpointBaseName(race.checkpoints[checkpointIndex]);
    return rawSplits.some(
      (split) =>
        isDepartureCheckpoint(race, split.checkpointIndex) &&
        checkpointBaseName(race.checkpoints[split.checkpointIndex]) === arrivalBase,
    );
  };
  const tablePoints = rawSplits.length && race
    ? race.checkpoints
        .map((place, checkpointIndex) => {
          const split = rawByCheckpoint.get(checkpointIndex);
          if (split) {
            return {
              checkpointIndex: split.checkpointIndex,
              place,
              clock: clockFromAbs(split.absMinutes),
              elapsed: splitTimeText(split.elapsedMinutes),
              elapsedMinutes: split.elapsedMinutes,
              absMinutes: split.absMinutes,
              missing: false,
            };
          }
          if (!shouldShowMissingArrival(checkpointIndex)) return null;
          return {
            checkpointIndex,
            place,
            clock: "-",
            elapsed: "-",
            elapsedMinutes: null,
            absMinutes: null,
            missing: true,
          };
        })
        .filter(Boolean)
    : evolution.positions;
  const previousTimedPoint = new Map();
  let latestTimed = null;
  for (const point of tablePoints) {
    previousTimedPoint.set(point.checkpointIndex, latestTimed);
    if (Number.isFinite(point.elapsedMinutes)) latestTimed = point;
  }
  const rankPoints = evolution.positions.filter((point) => point.checkpointIndex === 0 || isRankCheckpoint(race, point.checkpointIndex));
  const previousRankPointByCheckpoint = new Map();
  for (let index = 1; index < rankPoints.length; index += 1) {
    previousRankPointByCheckpoint.set(rankPoints[index].checkpointIndex, rankPoints[index - 1]);
  }
  const note = `<p class="split-note">Official-time rank and overtake skip ankomst rows. Avfärd rows are used for ranking; ankomst rows stay in the table for timing context. Leg time is measured from the previous published timing row, so it includes stop time when a matching ankomst and avfärd are both available. If the official rider detail page does not publish an arrival timestamp, the row is shown without a time.</p>`;
  const headers = [
    helpHeader("Checkpoint", "Timing mat name from the Vätternrundan result data."),
    helpHeader("Km", "Approximate course distance at this timing mat."),
    helpHeader("Elapsed", "Your elapsed race time since start."),
    helpHeader("Leg", "Elapsed time since the previous published timing row. This includes stop time between ankomst and avfärd rows."),
    helpHeader("Official-time rank", "Rank by elapsed race time at rank checkpoints only. Ankomst rows are excluded; the Mål row should match your result rank."),
    helpHeader("Δ rank", "Change in official-time rank since the previous rank checkpoint. Green + means you gained places; red - means you lost places."),
    helpHeader("Overtake", "Segment pass balance between rank checkpoints. Green + means you overtook more riders than passed you; red - means more riders passed you."),
  ].join("");
  return `<div class="table-scroll"><table class="data-table split-time-table"><thead><tr>${headers}</tr></thead><tbody>${tablePoints
    .map((point, index) => {
      const previous = previousTimedPoint.get(point.checkpointIndex);
      const official = officialByCheckpoint.get(point.checkpointIndex);
      const officialIndex = officialPositions.findIndex((item) => item.checkpointIndex === point.checkpointIndex);
      const previousOfficial = officialIndex > 0 ? officialPositions[officialIndex - 1] : null;
      const leg = point.missing || !previous ? "-" : splitDurationText(point.elapsedMinutes, previous.elapsedMinutes);
      const officialDelta =
        official && previousOfficial && Number.isFinite(official.position) && Number.isFinite(previousOfficial.position)
          ? official.position - previousOfficial.position
          : null;
      const previousRankPoint = previousRankPointByCheckpoint.get(point.checkpointIndex);
      const segment = previousRankPoint ? segmentByLabel.get(`${previousRankPoint.place} -> ${point.place}`) : null;
      const directNet = segment ? segment.you - segment.them : null;
      const officialText = official && Number.isFinite(official.position) ? official.position.toLocaleString() : "-";
      const rankCellClass = race && isArrivalCheckpoint(race, point.checkpointIndex) ? ' class="muted-row"' : "";
      const elapsedText = point.missing ? '<span class="muted-text">not published</span>' : esc(point.elapsed);
      return `<tr${rankCellClass}><td>${esc(point.place)}</td><td>${kms[point.checkpointIndex] ?? `${point.checkpointIndex + 1}/${tablePoints.length}`}</td><td>${elapsedText}</td><td>${leg}</td><td>${officialText}</td><td>${signedValueHtml(officialDelta, officialIndex, { invert: true })}</td><td>${signedValueHtml(directNet, segment ? 1 : 0)}</td></tr>`;
    })
    .join("")}</tbody></table></div>${note}`;
}

function checkpointKms(race) {
  const exact = {
    "vatternrundan-2026": [0, 48, 104, 104, 168, 174, 207, 242, 281, 313, 315],
    "halvvattern-2026": [0, 47, 86, 121, 150],
    "tjejvattern-2026": [0, 40, 73, 100],
    "vatternrundan-100-2026": [0, 40, 73, 100],
    "mtb-vattern-2026": [0, 10, 30, 50],
  }[race.id];
  if (exact) return exact;
  return race.checkpoints.map((_, index) => (race.distanceKm * index) / Math.max(1, race.checkpoints.length - 1));
}

function startGroupLabel(rider) {
  return rider.startClock || "n/a";
}

function classLabel(rider) {
  if (rider.gender === "F") return "Women";
  if (rider.gender === "M") return "Men";
  return "Open";
}

function rankedFinishers(race) {
  return defaultComparisonRiders(race).sort((a, b) => a.minutes - b.minutes || a.bib - b.bib);
}

function rankMap(race) {
  return new Map(rankedFinishers(race).map((rider, index) => [rider.participantId, index + 1]));
}

function officialTimeRankForSplit(race, rider, split) {
  return officialTimePositionForSplit(race, rider, split).position || null;
}

function splitSeries(race, rider) {
  const kms = checkpointKms(race);
  const splits = race.splitsByPid.get(rider.participantId) || [];
  return splits.map((split, index) => {
    const previous = splits[index - 1];
    const km = kms[split.checkpointIndex] ?? 0;
    const previousKm = previous ? (kms[previous.checkpointIndex] ?? 0) : 0;
    const legMinutes =
      previous && Number.isFinite(split.elapsedMinutes) && Number.isFinite(previous.elapsedMinutes)
        ? split.elapsedMinutes - previous.elapsedMinutes
        : split.elapsedMinutes;
    const legKm = Math.max(0, km - previousKm);
    return {
      checkpointIndex: split.checkpointIndex,
      checkpoint: race.checkpoints[split.checkpointIndex],
      km,
      elapsed: split.elapsedMinutes,
      leg: legMinutes,
      speed: Number.isFinite(legMinutes) && legMinutes > 0 && legKm > 0 ? legKm / (legMinutes / 60) : null,
      absMinutes: split.absMinutes,
      place: officialTimeRankForSplit(race, rider, split),
    };
  });
}

function legSpeedAtCheckpoint(race, rider, checkpointIndex, kms = checkpointKms(race)) {
  const splits = race.splitsByPid.get(rider.participantId) || [];
  const index = splits.findIndex((split) => split.checkpointIndex === checkpointIndex);
  if (index < 0) return null;
  const split = splits[index];
  const previous = splits[index - 1];
  if (!previous || !Number.isFinite(split.elapsedMinutes) || !Number.isFinite(previous.elapsedMinutes)) return null;
  const legMinutes = split.elapsedMinutes - previous.elapsedMinutes;
  const legKm = (kms[split.checkpointIndex] ?? 0) - (kms[previous.checkpointIndex] ?? 0);
  return legMinutes > 0 && legKm > 0 ? legKm / (legMinutes / 60) : null;
}

function riderShortName(rider) {
  const parts = String(rider.name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return rider.name || `Bib ${rider.bib}`;
  return `${parts[0].slice(0, 1)}. ${parts.slice(1).join(" ")}`;
}

function participantInfo(race, rider, rank, fieldSize, speed, fasterThan) {
  return `<section class="participant-header">
    <div class="participant-searchline">
      <button type="button" class="text-button" id="back-overview">← Back</button>
      <input readonly value="${esc(rider.name)}" />
    </div>
    <div class="participant-title-row">
      <div class="participant-title">
        ${countryFlagHtml(rider.country)}
        <h2>${esc(rider.name)}</h2>
      </div>
      <div class="participant-actions">
        <button id="copy-link-top" type="button">Share</button>
        <button id="screenshot-page" type="button">Screenshot</button>
        <button type="button" data-jump-tab="compare">Compare</button>
      </div>
    </div>
    <div class="participant-badges">
      <span>${esc(rider.bib)}</span>
      <span>${countryFlagHtml(rider.country, "country-flag-mini")} ${esc(countryLabel(rider.country))}</span>
      <span>${esc(rider.city || "n/a")}</span>
    </div>
    <div class="participant-stat-grid">
      <div><span>${esc(race.label)}</span><strong>${rider.finished ? "1" : "DNF"}</strong><em>2026</em></div>
      <div><span>Start</span><strong>${esc(startGroupLabel(rider))}</strong><em>clock time</em></div>
      <div><span>Best time</span><strong>${hhmm(rider.minutes)}</strong><em>2026</em></div>
      <div><span>Result rank</span><strong>${rank ? `#${rank.toLocaleString()}` : "DNF"}</strong><em>by elapsed time</em></div>
      <div><span>Best top %</span><strong>${fasterThan ? `Top ${Math.max(0, 100 - Number(fasterThan)).toFixed(0)}%` : "n/a"}</strong><em>${speed ? `${speed} km/h` : "no finish"}</em></div>
    </div>
  </section>`;
}

function insightCards(race, rider, rank, fieldSize, evolution, stats) {
  const rankText = rank ? `${rank.toLocaleString()} of ${fieldSize.toLocaleString()}` : "n/a";
  const slower = rank ? Math.max(0, fieldSize - rank) : null;
  const faster = rank ? Math.max(0, rank - 1) : null;
  const deltaMedian = rider.minutes !== null && stats.median !== null ? rider.minutes - stats.median : null;
  const medianText =
    deltaMedian === null
      ? "n/a"
      : deltaMedian < 0
        ? `${hhmm(Math.abs(deltaMedian))} faster`
        : deltaMedian > 0
          ? `${hhmm(deltaMedian)} behind`
          : "exactly median";
  return `<div class="insight-grid">
    <div class="insight-card"><span>Rank</span><strong>${rankText}</strong><em>${esc(race.comparison.label)}</em></div>
    <div class="insight-card"><span>People behind</span><strong>${slower === null ? "n/a" : slower.toLocaleString()}</strong><em>by finish time</em></div>
    <div class="insight-card"><span>People ahead</span><strong>${faster === null ? "n/a" : faster.toLocaleString()}</strong><em>by finish time</em></div>
    <div class="insight-card"><span>Vs median</span><strong>${esc(medianText)}</strong><em>median ${hhmm(stats.median)}</em></div>
    <div class="insight-card"><span>Timing mats</span><strong>${evolution ? `${evolution.youOvertook.toLocaleString()} / ${evolution.theyOvertook.toLocaleString()}` : "n/a"}</strong><em>overtaken / passed you</em></div>
  </div>`;
}

function nationalityBars(race) {
  const rows = countryRows(race, { country: "" }).slice(0, 10);
  const max = Math.max(...rows.map((row) => row.entries), 1);
  return `<div class="bar-list">${rows
    .map(
      (row) =>
        `<div class="bar-item"><span>${countryWithCodeHtml(row.country)}</span><i style="width:${(row.entries / max) * 100}%"><title>${esc(countryLabel(row.country))}: ${row.entries.toLocaleString()} entries, ${row.finishers.toLocaleString()} finishers</title></i><strong>${row.entries.toLocaleString()}</strong></div>`,
    )
    .join("")}</div>`;
}

function availableDnfRows(race) {
  const finishIndex = race.checkpoints.length - 1;
  return race.riders
    .map((rider) => {
      const splits = race.splitsByPid.get(rider.participantId) || [];
      const hasStart = splits.some((split) => split.checkpointIndex === 0);
      const hasFinish = splits.some((split) => split.checkpointIndex === finishIndex);
      if (!hasStart || hasFinish) return null;
      const last = [...splits].sort((a, b) => a.checkpointIndex - b.checkpointIndex || a.absMinutes - b.absMinutes).at(-1);
      return {
        rider,
        checkpointIndex: last ? last.checkpointIndex : 0,
        checkpoint: race.checkpoints[last ? last.checkpointIndex : 0] || "Start",
        clock: last ? clockFromAbs(last.absMinutes) : rider.startClock || "n/a",
        elapsed: last ? hhmm(last.elapsedMinutes) : "n/a",
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.checkpointIndex - a.checkpointIndex || a.rider.bib - b.rider.bib);
}

function dnfPanel(race) {
  const rows = availableDnfRows(race);
  const byCheckpoint = new Map();
  for (const row of rows) byCheckpoint.set(row.checkpoint, (byCheckpoint.get(row.checkpoint) || 0) + 1);
  const max = Math.max(...byCheckpoint.values(), 1);
  const locationBars = Array.from(byCheckpoint.entries())
    .sort((a, b) => b[1] - a[1])
    .map(
      ([checkpoint, count]) =>
        `<div class="bar-item wide-bar"><span>${esc(checkpoint)}</span><i style="width:${(count / max) * 100}%"></i><strong>${count.toLocaleString()}</strong></div>`,
    )
    .join("");
  const tableRows = rows
    .slice(0, 80)
    .map(
      ({ rider, checkpoint, clock, elapsed }) =>
        `<tr><td>${rider.bib}</td><td>${esc(rider.name)}</td><td>${countryWithCodeHtml(rider.country)}</td><td>${esc(checkpoint)}</td><td>${esc(clock)}</td><td>${esc(elapsed)}</td></tr>`,
    )
    .join("");
  return `<section class="content-grid">
    <div class="panel">
      <div class="panel-heading"><h3>Where people DNF</h3><p>${rows.length.toLocaleString()} available rider records, ${race.officialCounts.dnf.toLocaleString()} DNF</p></div>
      <div class="bar-list">${locationBars || '<div class="empty-state">No DNF locations available.</div>'}</div>
    </div>
    <div class="panel">
      <div class="panel-heading"><h3>DNF riders</h3><p>last known checkpoint from timing rows</p></div>
      <table class="data-table"><thead><tr><th>Bib</th><th>Name</th><th>Country</th><th>Last checkpoint</th><th>Clock</th><th>Elapsed</th></tr></thead><tbody>${tableRows}</tbody></table>
    </div>
  </section>`;
}

function simpleBarChartSvg(rows, options = {}) {
  if (!rows.length) return '<div class="empty-state">No chart data.</div>';
  const width = options.width || 560;
  const height = options.height || 390;
  const left = 64;
  const right = 26;
  const top = 42;
  const bottom = 130;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const max = Math.max(...rows.map((row) => row.value), 1);
  const yFor = (value) => top + chartHeight - (value / max) * chartHeight;
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((tick) => {
      const y = top + chartHeight * tick;
      return `<line x1="${left}" x2="${width - right}" y1="${y}" y2="${y}" class="grid" /><text x="${left - 10}" y="${y + 4}" text-anchor="end" class="axis">${Math.round(max * (1 - tick))}</text>`;
    })
    .join("");
  const bars = rows
    .map((row, index) => {
      const slot = chartWidth / rows.length;
      const barWidth = Math.max(8, slot * 0.72);
      const x = left + index * slot + (slot - barWidth) / 2;
      const y = yFor(row.value);
      const labelY = height - 82;
      return `<rect x="${x}" y="${y}" width="${barWidth}" height="${top + chartHeight - y}" fill="${row.color || "#74b8c7"}"><title>${esc(row.label)}: ${row.value.toLocaleString()}</title></rect><text x="${x + barWidth / 2}" y="${labelY}" text-anchor="end" transform="rotate(-34 ${x + barWidth / 2} ${labelY})" class="axis">${esc(row.label)}</text>`;
    })
    .join("");
  return `<svg class="chart dnf-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(options.label || "Bar chart")}">${grid}${bars}<line x1="${left}" x2="${width - right}" y1="${top + chartHeight}" y2="${top + chartHeight}" class="axis-line" /><text x="16" y="${top + chartHeight / 2}" text-anchor="middle" transform="rotate(-90 16 ${top + chartHeight / 2})" class="axis">${esc(options.yLabel || "Count")}</text></svg>`;
}

function barLineChartSvg(rows) {
  if (!rows.length) return '<div class="empty-state">No start group data.</div>';
  const width = 560;
  const height = 390;
  const left = 64;
  const right = 60;
  const top = 52;
  const bottom = 130;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const maxCount = Math.max(...rows.map((row) => row.count), 1);
  const maxRate = Math.max(...rows.map((row) => row.rate), 1);
  const yCount = (value) => top + chartHeight - (value / maxCount) * chartHeight;
  const yRate = (value) => top + chartHeight - (value / maxRate) * chartHeight;
  const xFor = (index) => left + (chartWidth * index) / Math.max(1, rows.length - 1);
  const bars = rows
    .map((row, index) => {
      const slot = chartWidth / rows.length;
      const barWidth = Math.max(8, slot * 0.62);
      const x = left + index * slot + (slot - barWidth) / 2;
      const y = yCount(row.count);
      const labelY = height - 82;
      return `<rect x="${x}" y="${y}" width="${barWidth}" height="${top + chartHeight - y}" fill="#74b8c7"><title>${esc(row.label)}: ${row.count} DNF, ${row.rate.toFixed(1)}%</title></rect><text x="${x + barWidth / 2}" y="${labelY}" text-anchor="end" transform="rotate(-34 ${x + barWidth / 2} ${labelY})" class="axis">${esc(row.label)}</text>`;
    })
    .join("");
  const line = rows.map((row, index) => `${index === 0 ? "M" : "L"} ${xFor(index)} ${yRate(row.rate)}`).join(" ");
  const dots = rows.map((row, index) => `<circle cx="${xFor(index)}" cy="${yRate(row.rate)}" r="4" fill="#c64f63" />`).join("");
  return `<svg class="chart dnf-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="DNF by start group">${bars}<path d="${line}" fill="none" stroke="#c64f63" stroke-width="3" />${dots}<line x1="${left}" x2="${width - right}" y1="${top + chartHeight}" y2="${top + chartHeight}" class="axis-line" /><text x="${left}" y="24" class="axis">DNF count</text><text x="${width - right}" y="24" text-anchor="end" class="axis">DNF rate %</text></svg>`;
}

function dnfDashboardPanel(race) {
  const rows = availableDnfRows(race);
  const kms = checkpointKms(race);
  const byCheckpoint = new Map();
  for (const row of rows) byCheckpoint.set(row.checkpoint, (byCheckpoint.get(row.checkpoint) || 0) + 1);
  const checkpointBars = race.checkpoints.map((checkpoint) => ({ label: checkpoint, value: byCheckpoint.get(checkpoint) || 0 }));
  const mostCommon = Array.from(byCheckpoint.entries()).sort((a, b) => b[1] - a[1])[0] || ["n/a", 0];
  const genders = rows.reduce(
    (acc, row) => {
      const key = row.rider.gender === "F" || row.rider.gender === "M" ? row.rider.gender : "U";
      acc[key] += 1;
      return acc;
    },
    { M: 0, F: 0, U: 0 },
  );
  const byStart = new Map();
  const starts = new Map();
  for (const rider of race.riders) {
    const label = startGroupLabel(rider);
    starts.set(label, (starts.get(label) || 0) + 1);
  }
  for (const row of rows) {
    const label = startGroupLabel(row.rider);
    byStart.set(label, (byStart.get(label) || 0) + 1);
  }
  const startRows = Array.from(starts.entries())
    .map(([label, total]) => ({ label, count: byStart.get(label) || 0, rate: total ? ((byStart.get(label) || 0) / total) * 100 : 0 }))
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(0, 18);
  const earlyCheckpoints = race.checkpoints.slice(1, Math.min(5, race.checkpoints.length));
  const speedRows = earlyCheckpoints.map((checkpoint, offset) => {
    const checkpointIndex = offset + 1;
    const dnfSpeeds = [];
    const finisherSpeeds = [];
    for (const rider of race.riders) {
      const speed = legSpeedAtCheckpoint(race, rider, checkpointIndex, kms);
      if (!Number.isFinite(speed)) continue;
      if (rider.finished) finisherSpeeds.push(speed);
      else dnfSpeeds.push(speed);
    }
    return {
      label: checkpoint,
      dnf: mean(dnfSpeeds),
      finishers: mean(finisherSpeeds),
    };
  });
  const earlySpeedSvg = lineChartSvg("Early speed: DNF vs finishers", "km/h", [
    { label: "DNF", color: "#c64f63", points: speedRows.map((row) => ({ label: row.label, value: row.dnf })) },
    { label: "Finishers", color: "#177a53", points: speedRows.map((row) => ({ label: row.label, value: row.finishers })) },
  ], { zeroMin: true, format: (value) => value.toFixed(0) });
  const distanceRows = race.checkpoints.map((checkpoint, index) => ({
    label: `${kms[index] ?? index} km`,
    value: rows.filter((row) => row.checkpointIndex === index).length,
    color: "#b8c8d6",
  }));
  const tableRows = rows
    .slice(0, 250)
    .map(
      ({ rider, checkpoint, clock, elapsed, checkpointIndex }) =>
        `<tr><td>${countryWithCodeHtml(rider.country)} ${esc(rider.name)}</td><td>${rider.bib}</td><td>${esc(classLabel(rider))}</td><td>${esc(startGroupLabel(rider))}</td><td>${esc(checkpoint)}</td><td>${kms[checkpointIndex] ?? "-"} km</td><td>${esc(clock)}</td><td>${esc(elapsed)}</td></tr>`,
    )
    .join("");
  const dnfRate = race.officialCounts.starters ? ((race.officialCounts.dnf / race.officialCounts.starters) * 100).toFixed(1) : "0.0";
  return `<section id="dnf" class="vasa-overview dnf-tab-view">
    <div class="overview-stat-grid dnf-stat-grid">
      ${overviewStatCard("DNF count", race.officialCounts.dnf.toLocaleString(), `${dnfRate}% of ${race.officialCounts.starters.toLocaleString()} starters`, "tone-red")}
      ${overviewStatCard("Most common dropout", mostCommon[0], `${mostCommon[1].toLocaleString()} dropouts`, "")}
      ${overviewStatCard("DNF by gender", `M ${genders.M.toLocaleString()} / F ${genders.F.toLocaleString()}`, genders.U ? `${genders.U.toLocaleString()} unknown gender` : "gender-filtered result data", "")}
      <div class="panel stat-card overview-stat"><h3>Export</h3><strong>PNG</strong><span><button id="screenshot-page" type="button">Screenshot</button></span></div>
    </div>
    <div class="compare-grid">
      <div class="panel"><div class="panel-heading"><h3>Dropouts per checkpoint</h3><p>last known timing mat</p></div>${simpleBarChartSvg(checkpointBars, { yLabel: "Dropouts" })}</div>
      <div class="panel"><div class="panel-heading"><h3>DNF by start group</h3><p>bars count, line rate</p></div>${barLineChartSvg(startRows)}</div>
      <div class="panel"><div class="panel-heading"><h3>Early speed</h3><p>DNF vs finishers</p></div>${earlySpeedSvg}</div>
      <div class="panel"><div class="panel-heading"><h3>Distance covered by DNF participants</h3><p>last checkpoint distance</p></div>${simpleBarChartSvg(distanceRows, { yLabel: "Participants" })}</div>
    </div>
    <div class="panel full-span"><div class="panel-heading"><h3>All DNF participants</h3><p>${rows.length.toLocaleString()} with timing rows shown first</p></div><div class="table-scroll"><table class="data-table"><thead><tr><th>Name</th><th>Bib</th><th>Class</th><th>Start</th><th>Last checkpoint</th><th>Distance</th><th>Clock</th><th>Elapsed</th></tr></thead><tbody>${tableRows}</tbody></table></div></div>
  </section>`;
}

function participationFlow(race) {
  const registered = race.riders.length;
  const starters = race.officialCounts.starters;
  const finishers = race.officialCounts.finishers;
  const dnf = race.officialCounts.dnf;
  const dns = Math.max(0, registered - starters);
  const pct = (value, base) => (base ? ((value / base) * 100).toFixed(1) : "0.0");
  const maxHeight = 176;
  const top = 32;
  const width = 980;
  const height = 248;
  const barWidth = 16;
  const x1 = 22;
  const x2 = 480;
  const x3 = 934;
  const scaled = (value, base, scale = maxHeight) => (base && value ? Math.max(3, (value / base) * scale) : 0);
  const registeredH = maxHeight;
  const startedH = scaled(starters, registered);
  const dnsH = Math.max(0, registeredH - startedH);
  const finishedH = scaled(finishers, starters, startedH);
  const dnfH = Math.max(0, startedH - finishedH);
  const dnsY = top + startedH;
  const dnfY = top + finishedH;
  const link = (fromX, fromY, fromH, toX, toY, toH, cls) => {
    if (fromH <= 0 || toH <= 0) return "";
    const mid = (fromX + toX) / 2;
    return `<path class="${cls}" d="M ${fromX} ${fromY} C ${mid} ${fromY}, ${mid} ${toY}, ${toX} ${toY} L ${toX} ${toY + toH} C ${mid} ${toY + toH}, ${mid} ${fromY + fromH}, ${fromX} ${fromY + fromH} Z" />`;
  };
  const rect = (x, y, h, cls) => `<rect class="${cls}" x="${x}" y="${y}" width="${barWidth}" height="${Math.max(h, 3)}" rx="1" />`;
  const label = (x, y, align, title, value, note, cls = "") =>
    `<text x="${x}" y="${y}" text-anchor="${align}" class="flow-ribbon-label ${cls}">${esc(title)} <tspan>${value.toLocaleString()}</tspan></text><text x="${x}" y="${y + 18}" text-anchor="${align}" class="flow-ribbon-note ${cls}">${esc(note)}</text>`;
  return `<svg class="flow-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Race participation flow">
    ${link(x1 + barWidth, top, startedH, x2, top, startedH, "flow-link-main")}
    ${link(x1 + barWidth, dnsY, dnsH, x2, dnsY, dnsH, "flow-link-muted")}
    ${link(x2 + barWidth, top, finishedH, x3, top, finishedH, "flow-link-good")}
    ${link(x2 + barWidth, dnfY, dnfH, x3, dnfY, dnfH, "flow-link-bad")}
    ${rect(x1, top, registeredH, "flow-bar-register")}
    ${rect(x2, top, startedH, "flow-bar-started")}
    ${rect(x2, dnsY, dnsH, "flow-bar-muted")}
    ${rect(x3, top, finishedH, "flow-bar-finished")}
    ${rect(x3, dnfY, dnfH, "flow-bar-dnf")}
    ${label(x1 + 28, top + registeredH * 0.54, "start", "Registered", registered, "entries")}
    ${label(x2 - 18, top + startedH * 0.54, "end", "Started", starters, `${pct(starters, registered)}% of registered`)}
    ${label(x2 + 28, dnsY + Math.max(18, dnsH * 0.5), "start", "DNS", dns, `${pct(dns, registered)}% of registered`, "flow-muted-text")}
    ${label(x3 - 24, top + finishedH * 0.54, "end", "Finished", finishers, `${pct(finishers, starters)}% of starters`)}
    ${label(x3 - 24, dnfY + Math.max(18, dnfH * 0.5), "end", "DNF", dnf, `${pct(dnf, starters)}% of starters`, "flow-dnf-text")}
  </svg>`;
}

function resultsTable(race, rider = null) {
  const sorted = race.riders
    .filter((item) => item.finished && item.minutes !== null)
    .sort((a, b) => a.minutes - b.minutes || a.bib - b.bib);
  const selectedIndex = rider ? sorted.findIndex((item) => item.participantId === rider.participantId) : -1;
  const rows = new Map();
  sorted.slice(0, 12).forEach((item, index) => rows.set(item.participantId, { item, rank: index + 1 }));
  if (selectedIndex >= 0) {
    const start = Math.max(0, selectedIndex - 3);
    sorted.slice(start, selectedIndex + 4).forEach((item, index) => rows.set(item.participantId, { item, rank: start + index + 1 }));
  }
  const ordered = Array.from(rows.values()).sort((a, b) => a.rank - b.rank);
  return `<table class="data-table"><thead><tr><th>Rank</th><th>Bib</th><th>Name</th><th>Country</th><th>Time</th></tr></thead><tbody>${ordered
    .map(
      ({ item, rank }) =>
        `<tr class="${rider && item.participantId === rider.participantId ? "selected-row" : ""}"><td>${rank.toLocaleString()}</td><td>${item.bib}</td><td>${esc(item.name)}</td><td>${countryWithCodeHtml(item.country)}</td><td>${hhmm(item.minutes)}</td></tr>`,
    )
    .join("")}</tbody></table>`;
}

function resultRowsForTab(race, selected, limit = state.resultLimit) {
  const ranks = rankMap(race);
  const cleaned = normalize(state.query);
  let rows = race.riders
    .map((rider) => ({ rider, rank: ranks.get(rider.participantId) || null }))
    .sort((a, b) => {
      if (a.rank && b.rank) return a.rank - b.rank;
      if (a.rank) return -1;
      if (b.rank) return 1;
      return a.rider.bib - b.rider.bib;
    });
  if (cleaned) {
    rows = rows.filter(({ rider }) => (race.searchIndex.get(rider.participantId) || "").includes(cleaned));
  }
  const total = rows.length;
  const limited = rows.slice(0, limit);
  if (selected && !limited.some(({ rider }) => rider.participantId === selected.participantId)) {
    const selectedIndex = rows.findIndex(({ rider }) => rider.participantId === selected.participantId);
    if (selectedIndex >= 0) limited.push(...rows.slice(Math.max(0, selectedIndex - 3), selectedIndex + 4));
  }
  const visible = Array.from(new Map(limited.map((row) => [row.rider.participantId, row])).values()).sort((a, b) => {
    if (a.rank && b.rank) return a.rank - b.rank;
    if (a.rank) return -1;
    if (b.rank) return 1;
    return a.rider.bib - b.rider.bib;
  });
  return { rows: visible, total };
}

function resultsTabPanel(race, selected) {
  const { rows, total } = resultRowsForTab(race, selected);
  const table = rows
    .map(({ rider, rank }) => {
      const splits = race.splitsByPid.get(rider.participantId) || [];
      const splitCells = race.checkpoints
        .slice(1, -1)
        .map((checkpoint, index) => {
          const point = splits.find((item) => item.checkpointIndex === index + 1);
          return `<td>${point && Number.isFinite(point.elapsedMinutes) ? hhmm(point.elapsedMinutes) : "-"}</td>`;
        })
        .join("");
      return `<tr class="${selected && selected.participantId === rider.participantId ? "selected-row" : ""}">
        <td>${rank ? rank.toLocaleString() : "-"}</td>
        <td>${rider.bib}</td>
        <td>${countryWithCodeHtml(rider.country)}</td>
        <td>${esc(rider.name)}</td>
        <td>${esc(classLabel(rider))}</td>
        <td>${esc(startGroupLabel(rider))}</td>
        <td>${hhmm(rider.minutes)}</td>
        ${splitCells}
        <td>${rider.finished ? "Finished" : "DNF"}</td>
      </tr>`;
    })
    .join("");
  const checkpointHeaders = race.checkpoints
    .slice(1, -1)
    .map((checkpoint) => `<th>${esc(checkpoint)}</th>`)
    .join("");
  return `<section id="results" class="vasa-overview result-tab-view">
    <div class="panel full-span">
      <div class="panel-heading"><div><h3>Full results</h3><p>${rows.length.toLocaleString()} of ${total.toLocaleString()} shown · scroll down to load more, or search by bib/name</p></div><button id="screenshot-page" type="button">Screenshot</button></div>
      <div class="table-scroll"><table class="data-table result-tab-table"><thead><tr><th>Place</th><th>Bib</th><th>Nat</th><th>Name</th><th>Class</th><th>Start</th><th>Time</th>${checkpointHeaders}<th>Status</th></tr></thead><tbody>${table}</tbody></table></div>
      ${rows.length < total ? `<button id="load-more-results" class="load-more-button" type="button">Load more results (${Math.min(total, rows.length + 80).toLocaleString()} / ${total.toLocaleString()})</button>` : ""}
    </div>
  </section>`;
}

function ensureCompareSelection(race, selected) {
  if (state.compareRaceId !== race.id) {
    state.compareRaceId = race.id;
    state.comparePids = [];
    state.compareQuery = "";
  }
  const valid = new Set(race.riders.map((rider) => rider.participantId));
  state.comparePids = state.comparePids.filter((pid) => valid.has(pid));
  if (!state.comparePids.length) {
    if (selected) state.comparePids.push(selected.participantId);
    const defaults = [
      race.fastestByGender?.M ? race.fastestByGender.M.participantId : null,
      race.fastestByGender?.F ? race.fastestByGender.F.participantId : null,
      ...rankedFinishers(race).slice(0, 5).map((rider) => rider.participantId),
    ];
    for (const pid of defaults) {
      if (pid && valid.has(pid) && !state.comparePids.includes(pid)) state.comparePids.push(pid);
      if (state.comparePids.length >= 2) break;
    }
  }
}

function compareRiders(race, selected) {
  ensureCompareSelection(race, selected);
  const picked = state.comparePids.map((pid) => race.ridersByPid.get(pid)).filter(Boolean);
  return picked.slice(0, 5);
}

function addCompareRider(race, pid) {
  ensureCompareSelection(race, selectedRider(race));
  const numeric = Number(pid);
  if (!race.ridersByPid.has(numeric) || state.comparePids.includes(numeric) || state.comparePids.length >= 5) return;
  state.comparePids.push(numeric);
}

function removeCompareRider(pid) {
  const numeric = Number(pid);
  state.comparePids = state.comparePids.filter((item) => item !== numeric);
}

function compareSearchResults(race) {
  const query = state.compareQuery.trim();
  if (!query) return [];
  return searchRiders(race, query).filter((rider) => !state.comparePids.includes(rider.participantId)).slice(0, 8);
}

function defaultBenchmarkRiders(race, selected) {
  const picked = [];
  const add = (rider) => {
    if (rider && !picked.some((item) => item.participantId === rider.participantId)) picked.push(rider);
  };
  add(selected);
  add(race.fastestByGender?.M ? race.ridersByPid.get(race.fastestByGender.M.participantId) : null);
  add(race.fastestByGender?.F ? race.ridersByPid.get(race.fastestByGender.F.participantId) : null);
  rankedFinishers(race).slice(0, 5).forEach(add);
  return picked.slice(0, 5);
}

function lineChartSvg(title, yLabel, series, options = {}) {
  const points = series.flatMap((item) => item.points.filter((point) => Number.isFinite(point.value)));
  if (!points.length) return '<div class="empty-state">Not enough checkpoint data.</div>';
  const width = 560;
  const height = 390;
  const left = 64;
  const right = 26;
  const legendCols = 2;
  const legendRows = Math.ceil(series.length / legendCols);
  const top = 42 + legendRows * 18;
  const bottom = 126;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const labels = series[0].points.map((point) => point.label);
  const values = points.map((point) => point.value);
  let min = options.zeroMin ? 0 : Math.min(...values);
  let max = Math.max(...values);
  if (options.invert) min = 1;
  if (max <= min) max = min + 1;
  const xFor = (index) => left + (chartWidth * index) / Math.max(1, labels.length - 1);
  const yFor = (value) =>
    options.invert
      ? top + ((value - min) / (max - min)) * chartHeight
      : top + chartHeight - ((value - min) / (max - min)) * chartHeight;
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((tick) => {
      const y = top + chartHeight * tick;
      const value = options.invert ? min + (max - min) * tick : max - (max - min) * tick;
      const label = options.format ? options.format(value) : Math.round(value).toString();
      return `<line x1="${left}" x2="${width - right}" y1="${y}" y2="${y}" class="grid" /><text x="${left - 10}" y="${y + 4}" text-anchor="end" class="axis">${esc(label)}</text>`;
    })
    .join("");
  const paths = series
    .map((item) => {
      let started = false;
      const path = item.points
        .map((point, index) => {
          if (!Number.isFinite(point.value)) return "";
          const command = started ? "L" : "M";
          started = true;
          return `${command} ${xFor(index)} ${yFor(point.value)}`;
        })
        .filter(Boolean)
        .join(" ");
      const dots = item.points
        .map((point, index) => (Number.isFinite(point.value) ? `<circle cx="${xFor(index)}" cy="${yFor(point.value)}" r="4" fill="${item.color}" />` : ""))
        .join("");
      return `<path d="${path}" fill="none" stroke="${item.color}" stroke-width="3" />${dots}`;
    })
    .join("");
  const legend = series
    .map((item, index) => {
      const col = index % legendCols;
      const row = Math.floor(index / legendCols);
      const x = left + col * 220;
      const y = 34 + row * 18;
      const label = item.label.length > 24 ? `${item.label.slice(0, 23)}...` : item.label;
      return `<rect x="${x}" y="${y - 10}" width="10" height="10" fill="${item.color}" /><text x="${x + 16}" y="${y}" class="axis legend-label">${esc(label)}</text>`;
    })
    .join("");
  const xLabels = labels
    .map((label, index) => {
      const x = xFor(index) - 4;
      const y = height - 80;
      return `<text x="${x}" y="${y}" text-anchor="end" transform="rotate(-32 ${x} ${y})" class="axis checkpoint-label">${esc(label)}</text>`;
    })
    .join("");
  return `<svg class="chart compare-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}"><text x="${left}" y="18" class="axis chart-title">${esc(title)}</text>${legend}${grid}<line x1="${left}" x2="${width - right}" y1="${top + chartHeight}" y2="${top + chartHeight}" class="axis-line" />${paths}${xLabels}<text x="18" y="${top + chartHeight / 2}" text-anchor="middle" transform="rotate(-90 18 ${top + chartHeight / 2})" class="axis">${esc(yLabel)}</text></svg>`;
}

function comparePanel(race, selected) {
  const riders = compareRiders(race, selected);
  const colors = ["#0f7590", "#c64f63", "#177a53", "#b78424", "#5f5aa2"];
  const suggestions = compareSearchResults(race);
  const needsMore = riders.length < 2;
  const series = riders.map((rider, index) => ({ rider, label: riderShortName(rider), color: colors[index % colors.length], data: splitSeries(race, rider) }));
  const elapsedSeries = series.map((item) => ({
    label: item.label,
    color: item.color,
    points: item.data.map((point) => ({ label: point.checkpoint, value: point.elapsed })),
  }));
  const speedSeries = series.map((item) => ({
    label: item.label,
    color: item.color,
    points: item.data.map((point) => ({ label: point.checkpoint, value: point.speed })),
  }));
  const placeSeries = series.map((item) => ({
    label: item.label,
    color: item.color,
    points: item.data.map((point) => ({ label: point.checkpoint, value: point.place })),
  }));
  const base = series[0]?.data || [];
  const gapSeries = series.map((item) => ({
    label: item.label,
    color: item.color,
    points: item.data.map((point, index) => ({ label: point.checkpoint, value: point.elapsed - (base[index]?.elapsed ?? point.elapsed) })),
  }));
  const summaryRows = riders
    .map((rider) => {
      const rank = rankMap(race).get(rider.participantId);
      const avgSpeed = rider.minutes ? (race.distanceKm / (rider.minutes / 60)).toFixed(1) : "n/a";
      return `<tr><td>${esc(riderShortName(rider))}</td><td>${hhmm(rider.minutes)}</td><td>${rank ? `#${rank}` : "DNF"}</td><td>${avgSpeed} km/h</td><td>${esc(classLabel(rider))}</td><td>${esc(startGroupLabel(rider))}</td></tr>`;
    })
    .join("");
  const splitRows = race.checkpoints
    .map((checkpoint, index) => {
      const cells = riders
        .map((rider) => {
          const point = splitSeries(race, rider).find((item) => item.checkpointIndex === index);
          return `<td>${point ? `${splitTimeText(point.elapsed)} ${point.speed ? `<span>${point.speed.toFixed(1)}</span>` : ""}` : "-"}</td>`;
        })
        .join("");
      return `<tr><td>${esc(checkpoint)}</td><td>${checkpointKms(race)[index] ?? ""}</td>${cells}</tr>`;
    })
    .join("");
  const chartHtml = needsMore
    ? `<div class="panel full-span empty-state compare-empty">Select at least two participants to compare.</div>`
    : `<div class="compare-grid">
      <div class="panel">${lineChartSvg("Elapsed time per checkpoint", "Time", elapsedSeries, { zeroMin: true, format: hhmm })}</div>
      <div class="panel">${lineChartSvg("Speed per segment", "km/h", speedSeries, { zeroMin: true, format: (value) => value.toFixed(0) })}</div>
      <div class="panel">${lineChartSvg("Placement per checkpoint", "Place", placeSeries, { invert: true, format: (value) => `#${Math.round(value)}` })}</div>
      <div class="panel">${lineChartSvg("Time gap vs first selected", "Gap", gapSeries, { format: (value) => `${value >= 0 ? "+" : "-"}${hhmm(Math.abs(value))}` })}</div>
    </div>`;
  const summaryHtml = needsMore
    ? ""
    : `<div class="panel full-span"><div class="panel-heading"><h3>Summary</h3><p>comparison riders</p></div><table class="data-table"><thead><tr><th>Name</th><th>Finish time</th><th>Place</th><th>Avg speed</th><th>Class</th><th>Start</th></tr></thead><tbody>${summaryRows}</tbody></table></div>
    <div class="panel full-span"><div class="panel-heading"><h3>Checkpoint splits</h3><p>elapsed time and speed</p></div><div class="table-scroll"><table class="data-table compare-split-table"><thead><tr><th>Checkpoint</th><th>Km</th>${riders.map((rider) => `<th>${esc(riderShortName(rider))}</th>`).join("")}</tr></thead><tbody>${splitRows}</tbody></table></div></div>`;
  return `<section id="compare" class="vasa-overview compare-tab-view">
    <div class="panel full-span compare-select-panel">
      <div class="panel-heading"><div><h3>Select participants to compare</h3><p>${riders.length.toLocaleString()} selected · add 2 to 5 riders</p></div><button id="screenshot-page" type="button">Screenshot</button></div>
      <label class="compare-search"><span>Search racer</span><input id="compare-search" inputmode="search" autocomplete="off" placeholder="Search bib or name..." value="${esc(state.compareQuery)}" /></label>
      <div class="compare-chips">${riders.map((rider, index) => `<span class="compare-chip" style="--chip:${colors[index % colors.length]}">${countryFlagHtml(rider.country, "country-flag-mini")} ${esc(riderShortName(rider))}<small>${rider.bib}</small><button type="button" data-remove-compare="${rider.participantId}" aria-label="Remove ${esc(rider.name)}">×</button></span>`).join("")}</div>
      <div class="compare-suggestions">${suggestions
        .map((rider) => `<button type="button" data-add-compare="${rider.participantId}"><strong>${rider.bib}</strong><span>${esc(rider.name)}</span><em>${countryWithCodeHtml(rider.country)}</em><b>${hhmm(rider.minutes)}</b></button>`)
        .join("")}</div>
    </div>
    ${chartHtml}
    ${summaryHtml}
  </section>`;
}

function fastestGenderCards(race) {
  const men = race.fastestByGender?.M;
  const women = race.fastestByGender?.F;
  const compactName = (name) => {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return name || "n/a";
    return `${parts[0].slice(0, 1)}. ${parts.slice(1).join(" ")}`;
  };
  const card = (title, rider, empty) =>
    `<div class="panel stat-card stat-card-fastest"><h3>${esc(title)}</h3><strong>${rider ? hhmm(rider.minutes) : "n/a"}</strong><span>${rider ? `${countryFlagHtml(rider.country, "country-flag-mini")} ${esc(compactName(rider.name))}` : esc(empty)}</span></div>`;
  return `
    ${card("Fastest time (men)", men, race.id === "tjejvattern-2026" ? "women-only event" : "No gender match found")}
    ${card("Fastest time (women)", women, "No gender match found")}
  `;
}

function difficultyCard(race) {
  const dnfRate = race.officialCounts.starters ? (race.officialCounts.dnf / race.officialCounts.starters) * 100 : 0;
  const weather = race.difficulty;
  if (!weather) {
    const label = dnfRate >= 5 ? "Demanding" : dnfRate >= 2 ? "Moderate" : "Low attrition";
    return `<div class="panel stat-card-wide"><h3>Difficulty</h3><strong>${label}</strong><span>${dnfRate.toFixed(1)}% DNF. Weather metadata is not loaded.</span></div>`;
  }
  const baseline = weather.baseline?.score;
  const percent = baseline ? Math.round((weather.currentYear.score / baseline) * 100) : null;
  const percentText = percent ? `${percent}% of recent weather difficulty` : "weather comparison available";
  return `<div class="panel stat-card-wide difficulty-card"><h3>Difficulty</h3><strong>${esc(weather.label)}</strong><span>${esc(percentText)} · ${weather.currentYear.avgTempC}C avg · ${weather.currentYear.rainMm} mm rain · max wind ${weather.currentYear.maxWindKmh} km/h · DNF ${dnfRate.toFixed(1)}%.</span></div>`;
}

function weatherPanel(race) {
  const weather = race.difficulty;
  if (!weather) return "";
  const current = weather.currentYear;
  const comparisons = weather.baseline?.comparisons || [];
  const baselineScore = weather.baseline?.score || current.score || 1;
  const rows = [
    { year: "2026", ...current },
    ...comparisons,
  ];
  return `<div class="panel full-span">
    <div class="panel-heading"><div><h3>Weather difficulty</h3><p>${esc(weather.source || "Historical weather archive")} · ${esc(weather.baseline?.years || "")}</p></div></div>
    <table class="data-table weather-table"><thead><tr><th>Year</th><th>Avg temp</th><th>Rain</th><th>Max wind</th><th>Max gust</th><th>Difficulty</th></tr></thead><tbody>${rows
      .map((row) => {
        const weatherPct = Math.round((row.score / baselineScore) * 100);
        return `<tr class="${row.year === "2026" ? "selected-row" : ""}"><td>${esc(row.year)}</td><td>${row.avgTempC}C</td><td>${row.rainMm} mm</td><td>${row.maxWindKmh} km/h</td><td>${row.maxGustKmh} km/h</td><td>${weatherPct}%</td></tr>`;
      })
      .join("")}</tbody></table>
    <p class="fine-print">100% is the ${esc(weather.baseline?.years || "same-window historical")} average. Higher percentages mean harder weather from rain, wind, gusts, and cold temperature.</p>
  </div>`;
}

function overviewStatCard(label, value, sub, tone = "") {
  return `<div class="panel stat-card overview-stat ${tone}"><h3>${esc(label)}</h3><strong>${esc(value)}</strong><span>${esc(sub)}</span></div>`;
}

function difficultyOverviewStrip(race) {
  const dnfRate = race.officialCounts.starters ? (race.officialCounts.dnf / race.officialCounts.starters) * 100 : 0;
  const weather = race.difficulty;
  if (!weather) {
    const label = dnfRate >= 5 ? "Demanding" : dnfRate >= 2 ? "Moderate" : "Low attrition";
    return `<div class="panel difficulty-strip"><div class="panel-heading"><div><h3>Difficulty</h3><p>${esc(label)} · DNF ${dnfRate.toFixed(1)}%</p></div></div></div>`;
  }
  const current = { year: 2026, ...weather.currentYear };
  const baselineScore = weather.baseline?.score || current.score || 1;
  const rows = [...(weather.baseline?.comparisons || []), current].sort((a, b) => Number(a.year) - Number(b.year));
  const diffs = rows.map((row) => Math.round((row.score / baselineScore) * 100) - 100);
  const maxAbs = Math.max(...diffs.map(Math.abs), 1);
  const currentPct = Math.round((current.score / baselineScore) * 100);
  const currentDiff = currentPct - 100;
  const diffText = `${currentDiff >= 0 ? "+" : ""}${currentDiff}% vs recent weather`;
  const tempText = `${current.minTempC}C to ${current.maxTempC}C, rain ${current.rainMm} mm, wind ${current.maxWindKmh} km/h`;
  const visibleRows = state.hideDifficultyYears ? rows.filter((row) => row.year === 2026) : rows;
  const rowHtml = visibleRows
    .map((row) => {
      const pct = Math.round((row.score / baselineScore) * 100);
      const diff = pct - 100;
      const width = Math.max(4, (Math.abs(diff) / maxAbs) * 46);
      const style = diff >= 0 ? `left:50%;width:${width}%` : `right:50%;width:${width}%`;
      return `<div class="difficulty-row ${row.year === 2026 ? "current" : ""}">
        <span>${row.year}</span>
        <i><b class="${diff >= 0 ? "harder" : "easier"}" style="${style}"></b></i>
        <strong>${diff >= 0 ? "+" : ""}${diff}%</strong>
        <em>${row.avgTempC}C · ${row.rainMm} mm rain</em>
      </div>`;
    })
    .join("");
  return `<div class="panel difficulty-strip">
    <div class="panel-heading">
      <div><h3>Difficulty</h3><p>${esc(diffText)} · ${esc(tempText)}</p></div>
      <button id="toggle-difficulty-years" type="button" class="hide-link">${state.hideDifficultyYears ? "Show years ▼" : "Hide years ▲"}</button>
    </div>
    ${state.hideDifficultyYears ? "" : '<div class="difficulty-scale"><span>← Easier weather</span><span>Harder weather →</span></div>'}
    <div class="difficulty-rows">${rowHtml}</div>
    <p class="difficulty-footnote">${state.hideDifficultyYears ? `Showing 2026 only: ${current.rainMm} mm rain, ${current.avgTempC}C avg, ${current.maxWindKmh} km/h max wind.` : `100% is the ${esc(weather.baseline?.years || "same-window historical")} average. Formula: rain x1.7 + wind x0.18 + gust x0.12 + cold penalty below 18C.`}</p>
  </div>`;
}

function nationalityChart(race) {
  const rows = countryRows(race, { country: "" }).slice(0, 10);
  if (!rows.length) return '<div class="empty-state">No nationality data.</div>';
  const width = 980;
  const rowHeight = 28;
  const left = 92;
  const right = 40;
  const top = 26;
  const bottom = 42;
  const chartWidth = width - left - right;
  const height = top + bottom + rowHeight * rows.length;
  const max = Math.max(...rows.map((row) => row.entries), 1);
  const tickMax = Math.ceil(max / 1000) * 1000 || max;
  const xFor = (value) => left + (value / tickMax) * chartWidth;
  const palette = ["#0f7590", "#c64f63", "#177a53", "#b78424", "#5f5aa2", "#d16d2a", "#3a9188", "#6a8f45", "#3f78b5", "#a85558"];
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((tick) => {
      const x = left + chartWidth * tick;
      return `<line x1="${x}" x2="${x}" y1="${top - 8}" y2="${height - bottom + 8}" class="grid" /><text x="${x}" y="${height - 12}" text-anchor="middle" class="axis">${Math.round(tickMax * tick).toLocaleString()}</text>`;
    })
    .join("");
  const bars = rows
    .map((row, index) => {
      const y = top + index * rowHeight;
      const barWidth = Math.max(2, xFor(row.entries) - left);
      const label = `${row.country || "n/a"} ${row.entries.toLocaleString()}`;
      const valueX = Math.min(width - right - 8, left + barWidth + 8);
      const flagUrl = countryFlagUrl(row.country);
      const flag = flagUrl ? `<image href="${esc(flagUrl)}" x="${left - 74}" y="${y + 3}" width="24" height="16" preserveAspectRatio="xMidYMid slice"><title>${esc(row.country || "n/a")} flag</title></image>` : "";
      return `${flag}<text x="${left - 12}" y="${y + 16}" text-anchor="end" class="axis">${esc(row.country || "n/a")}</text><rect x="${left}" y="${y + 3}" width="${barWidth}" height="16" fill="${palette[index % palette.length]}"><title>${esc(row.country || "n/a")}: ${row.entries.toLocaleString()} entries, ${row.finishers.toLocaleString()} finishers</title></rect><text x="${valueX}" y="${y + 16}" class="axis nationality-value">${esc(label)}</text>`;
    })
    .join("");
  return `<svg class="chart nationality-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Nationality top 10">${grid}${bars}<line x1="${left}" x2="${width - right}" y1="${height - bottom + 8}" y2="${height - bottom + 8}" class="axis-line" /><text x="${left + chartWidth / 2}" y="${height - 2}" text-anchor="middle" class="axis">Participants</text></svg>`;
}

function raceOverviewPanel(race, stats, values) {
  const dnfRate = race.officialCounts.starters
    ? ((race.officialCounts.dnf / race.officialCounts.starters) * 100).toFixed(1)
    : "0.0";
  const finishRate = race.officialCounts.starters
    ? ((race.officialCounts.finishers / race.officialCounts.starters) * 100).toFixed(1)
    : "0.0";
  const startedRate = race.riders.length ? ((race.officialCounts.starters / race.riders.length) * 100).toFixed(1) : "0.0";
  const comparison = defaultComparisonRiders(race);
  return `<section id="overview" class="vasa-overview">
    <div class="overview-fastest-grid">${fastestGenderCards(race)}</div>
    <div class="overview-stat-grid">
      ${overviewStatCard("Starters", race.officialCounts.starters.toLocaleString(), `${startedRate}% of registered`, "tone-green")}
      ${overviewStatCard("Finishers", race.officialCounts.finishers.toLocaleString(), `${finishRate}% of starters`, "tone-green")}
      ${overviewStatCard("DNF rate", `${dnfRate}%`, `${race.officialCounts.dnf.toLocaleString()} DNF`, "tone-red")}
      ${overviewStatCard("Median finish time", hhmm(stats.median), `${values.length.toLocaleString()} ${race.comparison.label}`, "")}
    </div>
    ${difficultyOverviewStrip(race)}
    <div class="panel full-span overview-chart-panel">
      <div class="panel-heading"><div><h3>Finish times - all participants</h3><p>${values.length.toLocaleString()} finishers · 15-minute brackets</p></div></div>
      ${genderedHistogramSvg(comparison, [
        { label: "Median", value: stats.median, color: "#111827" },
        { label: "Top 25%", value: stats.q25, color: "#218253" },
        { label: "Top 10%", value: stats.q10, color: "#d97706" },
      ])}
    </div>
    <div class="panel full-span overview-chart-panel"><div class="panel-heading"><h3>Nationality - top 10</h3><p>registered entries</p></div>${nationalityChart(race)}</div>
    <div id="dnf" class="panel full-span overview-chart-panel"><div class="panel-heading"><h3>Race participation flow</h3><p>registered → DNS / started → DNF / finished</p></div>${participationFlow(race)}</div>
  </section>`;
}

function analyticsPanel(race, rider, stats, values) {
  const dnfRate = race.officialCounts.starters
    ? `${((race.officialCounts.dnf / race.officialCounts.starters) * 100).toFixed(1)}%`
    : "n/a";
  return `<section class="analysis-grid">
    <div class="panel stat-card-wide"><h3>Fastest time</h3><strong>${hhmm(stats.fastest)}</strong><span>${values.length.toLocaleString()} ${esc(race.comparison.label)}</span></div>
    <div class="panel stat-card-wide"><h3>Median finish time</h3><strong>${hhmm(stats.median)}</strong><span>middle rider by finish time</span></div>
    ${fastestGenderCards(race)}
    ${difficultyCard(race)}
    <div class="panel stat-card"><h3>Starters</h3><strong>${race.officialCounts.starters.toLocaleString()}</strong></div>
    <div class="panel stat-card"><h3>Finishers</h3><strong>${race.officialCounts.finishers.toLocaleString()}</strong></div>
    <div class="panel stat-card"><h3>DNF rate</h3><strong>${dnfRate}</strong></div>
    <div class="panel full-span"><div class="panel-heading"><div><h3>Finish times - all participants</h3><p>${values.length.toLocaleString()} finishers · 15-minute brackets</p></div></div>${histogramSvg(values, [
      { label: "Median", value: stats.median, color: "#c43131" },
      { label: "Top 25%", value: stats.q25, color: "#23824f" },
      { label: "Top 10%", value: stats.q10, color: "#d97706" },
    ])}</div>
    <div class="panel"><div class="panel-heading"><h3>Nationality - top 10</h3><p>registered entries</p></div>${nationalityBars(race)}</div>
    <div class="panel"><div class="panel-heading"><h3>Race participation flow</h3><p>timing counts</p></div>${participationFlow(race)}</div>
    ${weatherPanel(race)}
    <div class="panel full-span"><div class="panel-heading"><h3>Results table</h3><p>${rider ? "leaders plus selected rider" : "leaders"}</p></div>${resultsTable(race, rider)}</div>
  </section>`;
}

function buildReportText(race, rider, stats, rank, fieldSize, evolution) {
  const speed = rider.minutes ? `${(race.distanceKm / (rider.minutes / 60)).toFixed(1)} km/h` : "n/a";
  const lines = [
    `${race.title} - bib ${rider.bib}`,
    `${rider.name} (${rider.city || "unknown city"}, ${rider.country || "country n/a"})`,
    "",
    `Finish time: ${hhmm(rider.minutes)}`,
    `Start: ${rider.startClock || "n/a"}`,
    `Finish: ${rider.finishClock || "n/a"}`,
    `Average speed: ${speed}`,
    "",
    `Fastest: ${hhmm(stats.fastest)}`,
    `Median: ${hhmm(stats.median)}`,
  ];
  if (rank && rider.minutes !== null) {
    const slower = fieldSize - rank;
    lines.push(`Rank by time: ${rank} of ${fieldSize}`);
    lines.push(`Faster than ${((slower / fieldSize) * 100).toFixed(1)}% of ${race.comparison.label}`);
  } else {
    lines.push("Rank by time: DNF / no finish");
  }
  lines.push("", `Starters: ${race.officialCounts.starters}`, `Finishers: ${race.officialCounts.finishers}`, `DNF: ${race.officialCounts.dnf}`);
  if (evolution) {
    lines.push("", "Race evolution");
    lines.push(`Timing-mat estimate: you overtook ${evolution.youOvertook}; ${evolution.theyOvertook} overtook you.`);
    for (const point of evolution.positions) lines.push(`${point.place}: estimated position ${point.position}`);
  }
  lines.push("", "Source: Vätternrundan result pages. Overtakes are inferred from checkpoint timing order changes, not GPS.");
  return lines.join("\n");
}

function metric(label, value, tone = "blue") {
  return `<div class="metric metric-${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}

function raceDescription(race) {
  if (race.id === "vatternrundan-2026") return "Vätternrundan loop, 315 km";
  if (race.id === "halvvattern-2026") return "Halvvättern, 150 km";
  if (race.id === "tjejvattern-2026") return "Tjejvättern, women only, 100 km";
  if (race.id === "vatternrundan-100-2026") return "Vätternrundan, 100 km";
  if (race.id === "mtb-vattern-2026") return "MTB-Vättern course, Motala";
  return `${race.distanceKm} km cycling race`;
}

function raceTabLabel(race) {
  if (race.id === "vatternrundan-2026") return ["315 km", "Vätternrundan"];
  if (race.id === "halvvattern-2026") return ["150 km", "Halvvättern"];
  if (race.id === "tjejvattern-2026") return ["100 km", "Tjejvättern"];
  if (race.id === "vatternrundan-100-2026") return ["100 km", "Vätternrundan"];
  if (race.id === "mtb-vattern-2026") return ["MTB", "MTB-Vättern"];
  return [`${race.distanceKm} km`, race.label];
}

function renderTabs() {
  els.tabs.innerHTML = state.races
    .map((race) => {
      const [main, sub] = raceTabLabel(race);
      return `<button type="button" class="${race.id === state.raceId ? "active" : ""}" data-race="${esc(race.id)}" title="${esc(raceDescription(race))}"><strong>${esc(main)}</strong><span>${esc(sub)}</span></button>`;
    })
    .join("");
  els.tabs.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.raceId = button.dataset.race;
      state.selectedPid = null;
      state.query = "";
      state.activeTab = "overview";
      state.siteTab = "overview";
      state.resultLimit = 80;
      state.comparePids = [];
      state.compareQuery = "";
      els.search.value = "";
      render();
    });
  });
}

function syncSiteNav() {
  els.siteNav.forEach((link) => {
    link.classList.toggle("active", link.dataset.siteTab === state.siteTab);
  });
}

function bindPageActions(race, rider, shareUrl = rider ? selectedUrl(race, rider) : window.location.href) {
  bindColumnTooltips();
  document.querySelectorAll("#copy-link, #copy-link-top").forEach((button) => {
    button.addEventListener("click", (event) => copyToClipboard(shareUrl, event.currentTarget, "Copied"));
  });
  document.querySelectorAll("#screenshot-page").forEach((button) => {
    button.addEventListener("click", (event) => downloadPageScreenshot(event.currentTarget));
  });
  document.querySelectorAll("[data-jump-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.siteTab = button.dataset.jumpTab;
      render();
    });
  });
  const back = document.getElementById("back-overview");
  if (back) {
    back.addEventListener("click", () => {
      state.selectedPid = null;
      state.query = "";
      els.search.value = "";
      state.siteTab = "overview";
      state.resultLimit = 80;
      render();
    });
  }
  const difficultyToggle = document.getElementById("toggle-difficulty-years");
  if (difficultyToggle) {
    difficultyToggle.addEventListener("click", () => {
      state.hideDifficultyYears = !state.hideDifficultyYears;
      render();
    });
  }
  const loadMore = document.getElementById("load-more-results");
  if (loadMore) {
    const load = () => {
      state.resultLimit += 80;
      render();
    };
    loadMore.addEventListener("click", load);
    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer.disconnect();
            load();
          }
        },
        { rootMargin: "700px" },
      );
      observer.observe(loadMore);
    }
  }
  const compareSearch = document.getElementById("compare-search");
  if (compareSearch) {
    compareSearch.addEventListener("input", () => {
      state.compareQuery = compareSearch.value;
      render();
      setTimeout(() => {
        const input = document.getElementById("compare-search");
        if (input) {
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }
      }, 0);
    });
  }
  document.querySelectorAll("[data-add-compare]").forEach((button) => {
    button.addEventListener("click", () => {
      addCompareRider(race, button.dataset.addCompare);
      state.compareQuery = "";
      render();
    });
  });
  document.querySelectorAll("[data-remove-compare]").forEach((button) => {
    button.addEventListener("click", () => {
      removeCompareRider(button.dataset.removeCompare);
      render();
    });
  });
}

function renderResults(race, selected) {
  const results = searchRiders(race, state.query);
  els.results.innerHTML = `<div class="search-table" role="list">${results
    .map(
      (rider) =>
        `<button type="button" class="${selected && selected.participantId === rider.participantId ? "selected" : ""}" data-pid="${rider.participantId}" role="listitem"><strong>${rider.bib}</strong><span>${esc(rider.name)}</span><em>${esc(rider.city || "n/a")}</em><i>${countryFlagHtml(rider.country, "country-flag-mini")}</i><b>${hhmm(rider.minutes)}</b></button>`,
    )
    .join("")}</div>`;
  els.results.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedPid = Number(button.dataset.pid);
      const rider = race.ridersByPid.get(state.selectedPid);
      state.query = String(rider.bib);
      els.search.value = state.query;
      state.activeTab = "overview";
      render();
    });
  });
}

function renderSelected(race, rider) {
  if (!race) {
    els.selected.innerHTML = `<section class="empty-band"><h2>Loading result data</h2><p>Preparing lookup.</p></section>`;
    return;
  }

  if (state.siteTab === "results") {
    els.selected.innerHTML = resultsTabPanel(race, rider);
    bindPageActions(race, rider);
    return;
  }

  if (state.siteTab === "compare") {
    els.selected.innerHTML = comparePanel(race, rider);
    bindPageActions(race, rider);
    return;
  }

  if (state.siteTab === "dnf") {
    els.selected.innerHTML = dnfDashboardPanel(race);
    bindPageActions(race, rider);
    return;
  }

  if (!rider) {
    const comparison = defaultComparisonRiders(race);
    const values = comparison.map((item) => item.minutes);
    const stats = statBlock(values);
    els.selected.innerHTML = `${raceOverviewPanel(race, stats, values)}`;
    bindHistogramInteractions();
    bindPageActions(race, rider);
    return;
  }

  const comparison = comparisonRiders(race, rider);
  const values = comparison.map((item) => item.minutes);
  const stats = statBlock(values);
  const ranks = rankMap(race);
  const rank = rider.minutes !== null ? ranks.get(rider.participantId) || values.filter((value) => value < rider.minutes).length + 1 : null;
  const fasterThan = rank && values.length ? (((values.length - rank) / values.length) * 100).toFixed(1) : null;
  const speed = rider.minutes ? (race.distanceKm / (rider.minutes / 60)).toFixed(1) : null;
  const evolution = sortSegments(race, buildEvolution(race, rider));
  const officialTimeEvolution = buildOfficialTimeEvolution(race, rider);
  const shareUrl = selectedUrl(race, rider);
  const net = evolution ? evolution.netOvertakes : null;
  const timeWindow = evolution ? `${evolution.positions[0].clock} to ${evolution.positions.at(-1).clock}` : "your ride";

  const histogramPanel = `
    <div class="panel chart-panel">
      <div class="panel-heading"><div><h3>Where you finished (2026)</h3><p>${values.length.toLocaleString()} ${esc(race.comparison.label)} · men/women stacked when gender cache is available</p></div></div>
      ${genderedHistogramSvg(comparison, [
        { label: "Your ride", value: rider.minutes, color: "#111827" },
        { label: "Median", value: stats.median, color: "#6d6d6d" },
      ])}
    </div>
  `;

  const evolutionPanel = `
    <div class="panel">
      <div class="panel-heading"><div><h3>Overtakes during your biking timeframe</h3><p>${evolution ? `${coloredCountHtml(evolution.youOvertook, "positive")} unique riders overtaken · ${coloredCountHtml(evolution.theyOvertook, "negative")} unique riders passed you · unique net ${signedValueHtml(net, 1)}` : "No checkpoint detail"}</p></div></div>
      ${overtakeBars(evolution)}
      <p class="fine-print">This chart only compares riders who were active during your biking timeframe (${esc(timeWindow)}). Segment rows count direct timing-mat pass events; the headline counts unique riders, so repeated back-and-forth passes can make the totals differ.</p>
    </div>
  `;

  const officialTimeEvolutionPanel = `
    <div class="panel">
      <div class="panel-heading"><div><h3>Official-time checkpoint rank</h3><p>elapsed-time ranking at rank checkpoints, regardless of start time</p></div></div>
      ${evolutionSvg(officialTimeEvolution, {
        label: "Official-time checkpoint rank",
        noteTitle: "Official-time rank",
        note: "This chart ranks riders by elapsed race time at ranking checkpoints within the same comparison field as your result. Ankomst rows are excluded from the rank line; avfärd rows are kept.",
        large: true,
      })}
    </div>
  `;

  const splitPanel = `
    <div class="panel compact-panel">
      <div class="panel-heading"><h3>Split times (2026)</h3></div>
      ${splitTimesTable(evolution, officialTimeEvolution, race, rider)}
    </div>
  `;

  els.selected.innerHTML = `
    <section class="participant-page">
      ${participantInfo(race, rider, rank, values.length, speed, fasterThan)}
      <div class="participant-kpis">
        <span><strong>${hhmm(rider.minutes)}</strong> finish time</span>
        <span><strong>${speed ? `${speed} km/h` : "n/a"}</strong> average speed</span>
        <span><strong>${rank ? `#${rank.toLocaleString()}` : "DNF"}</strong> official comparison rank</span>
        <span><strong>${evolution ? `${coloredCountHtml(evolution.youOvertook, "positive")} / ${coloredCountHtml(evolution.theyOvertook, "negative")} ${signedValueHtml(net, 1)}` : "n/a"}</strong> overtaken / passed / net during ride</span>
      </div>
      <section class="content-grid">${histogramPanel}${officialTimeEvolutionPanel}</section>
      <section class="content-grid">${evolutionPanel}${splitPanel}</section>
      <p class="source-note">${esc(race.source)} Race evolution is inferred from timing mats, not GPS.</p>
    </section>
  `;

  bindHistogramInteractions();
  bindPageActions(race, rider, shareUrl);

  const params = new URLSearchParams();
  params.set("race", race.id);
  params.set("bib", String(rider.bib));
  params.set("tab", state.siteTab);
  window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
}

function render() {
  const race = currentRace();
  const selected = selectedRider(race);
  if (els.raceCrumb && race) els.raceCrumb.textContent = race.label;
  syncSiteNav();
  renderTabs();
  renderResults(race, selected);
  renderSelected(race, selected);
}

els.siteNav.forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    if (!link.dataset.siteTab) return;
    state.siteTab = link.dataset.siteTab;
    state.resultLimit = 80;
    render();
  });
});

els.search.addEventListener("input", () => {
  const race = currentRace();
  state.query = els.search.value;
  state.resultLimit = 80;
  state.selectedPid = null;
  if (race && state.siteTab === "overview") {
    const cleaned = normalize(state.query);
    const exactBib = /^\d+$/.test(state.query.trim())
      ? race.riders.find((rider) => String(rider.bib) === state.query.trim())
      : null;
    const exactName = race.riders.find((rider) => normalize(rider.name) === cleaned);
    const matches = searchRiders(race, state.query);
    const automatic = exactBib || exactName || (cleaned.length > 2 && matches.length === 1 ? matches[0] : null);
    if (automatic) state.selectedPid = automatic.participantId;
  }
  if (state.selectedPid) {
    state.activeTab = "overview";
    state.siteTab = "overview";
  }
  render();
});

fetch("data/races.json")
  .then((response) => response.json())
  .then((file) => {
    state.races = file.races.map(prepareRace);
    const params = new URLSearchParams(window.location.search);
    const requestedRace = params.get("race");
    const requestedBib = params.get("bib");
    const requestedTab = params.get("tab");
    if (state.races.some((race) => race.id === requestedRace)) state.raceId = requestedRace;
    if (["overview", "results", "compare", "dnf"].includes(requestedTab)) state.siteTab = requestedTab;
    const race = currentRace();
    if (requestedBib && race) {
      const exact = race.riders.find((rider) => String(rider.bib) === requestedBib);
      if (exact) {
        state.selectedPid = exact.participantId;
        state.query = String(exact.bib);
        els.search.value = state.query;
      }
    }
    render();
  })
  .catch((error) => {
    els.selected.innerHTML = `<section class="empty-band"><h2>Could not load result data</h2><p>${esc(error.message)}</p></section>`;
  });
