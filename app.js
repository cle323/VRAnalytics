const state = {
  races: [],
  raceId: "tjejvattern-2026",
  query: "",
  selectedPid: null,
};

const els = {
  tabs: document.getElementById("race-tabs"),
  search: document.getElementById("search"),
  results: document.getElementById("results"),
  selected: document.getElementById("selected-view"),
};

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

function clockFromAbs(absMinutes) {
  const value = ((Math.round(absMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
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
  };
}

function tupleToSplit(row) {
  return {
    participantId: row[0],
    checkpointIndex: row[1],
    absMinutes: row[2],
    elapsedMinutes: row[3],
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
    slowest: sorted[sorted.length - 1] ?? null,
    mean: mean(sorted),
    spread: stdDev(sorted),
    q10: percentile(sorted, 0.1),
    q25: percentile(sorted, 0.25),
    median: percentile(sorted, 0.5),
    q75: percentile(sorted, 0.75),
  };
}

function searchRiders(race, query) {
  if (!race) return [];
  const cleaned = normalize(query);
  if (!cleaned) return race.riders.slice(0, 8);
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

function buildEvolution(race, rider) {
  const mySplits = race.splitsByPid.get(rider.participantId);
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
        if (my.checkpointIndex === finishIndex || finish === undefined || finish > my.absMinutes) active.add(pid);
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
  };
}

function histogramSvg(values, markers) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return '<div class="empty-state">No finish-time data.</div>';
  const min = Math.floor((sorted[0] - 5) / 15) * 15;
  const max = Math.ceil((sorted[sorted.length - 1] + 5) / 15) * 15;
  const binCount = 52;
  const binWidth = (max - min) / binCount;
  const bins = Array.from({ length: binCount }, () => 0);
  for (const value of sorted) {
    const index = Math.max(0, Math.min(binCount - 1, Math.floor((value - min) / binWidth)));
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
      return `<rect x="${x}" y="${y}" width="${barWidth}" height="${top + chartHeight - y}" rx="1" class="hist-bar" />`;
    })
    .join("");
  const markerSvg = markers
    .filter((marker) => marker.value !== null && Number.isFinite(marker.value))
    .map((marker) => {
      const x = xFor(marker.value);
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

  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Finish time histogram">${grid}${bars}${markerSvg}${legend}<line x1="${left}" x2="${width - right}" y1="${top + chartHeight}" y2="${top + chartHeight}" class="axis-line" />${ticks}</svg>`;
}

function evolutionSvg(evolution) {
  if (!evolution || !evolution.positions.length) {
    return '<div class="empty-state">Checkpoint evolution is not available for this rider.</div>';
  }
  const width = 980;
  const height = 390;
  const left = 62;
  const right = 24;
  const top = 34;
  const bottom = 74;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const maxPosition = Math.max(...evolution.positions.map((point) => point.position), 1);
  const xFor = (index) => left + (chartWidth * index) / Math.max(1, evolution.positions.length - 1);
  const yFor = (value) => top + (value / maxPosition) * chartHeight;
  const path = evolution.positions
    .map((point, index) => `${index === 0 ? "M" : "L"} ${xFor(index)} ${yFor(point.position)}`)
    .join(" ");
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((tick) => {
      const y = top + chartHeight * tick;
      return `<line x1="${left}" x2="${width - right}" y1="${y}" y2="${y}" class="grid" /><text x="${left - 12}" y="${y + 5}" text-anchor="end" class="axis">${Math.round(maxPosition * tick)}</text>`;
    })
    .join("");
  const points = evolution.positions
    .map((point, index) => {
      const x = xFor(index);
      const y = yFor(point.position);
      const labelX = index === 0 ? x + 24 : index === evolution.positions.length - 1 ? x - 24 : x;
      return `<circle cx="${x}" cy="${y}" r="6" class="evolution-dot" /><text x="${labelX}" y="${y - 14}" text-anchor="middle" class="marker-blue">${point.position}</text><text x="${x}" y="${height - 34}" text-anchor="middle" class="axis checkpoint-label">${esc(point.place)}</text>`;
    })
    .join("");
  const bars = evolution.segments
    .map((segment) => {
      const max = Math.max(segment.you, segment.them, 1);
      return `<div class="segment"><span>${esc(segment.label)}</span><div class="bar-row"><i class="bar-positive" style="width:${(segment.you / max) * 100}%"></i><b>${segment.you}</b></div><div class="bar-row"><i class="bar-negative" style="width:${(segment.them / max) * 100}%"></i><b>${segment.them}</b></div></div>`;
    })
    .join("");
  return `<div class="evolution-grid"><svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Race evolution">${grid}<path d="${path}" fill="none" class="evolution-line" />${points}</svg><div class="segment-bars">${bars}</div></div>`;
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
  for (let index = 0; index < race.checkpoints.length - 1; index += 1) {
    order.set(`${race.checkpoints[index]} -> ${race.checkpoints[index + 1]}`, index);
  }
  return {
    ...evolution,
    segments: [...evolution.segments].sort((a, b) => (order.get(a.label) ?? 999) - (order.get(b.label) ?? 999)),
  };
}

function buildReportText(race, rider, stats, rank, fieldSize, evolution) {
  const speed = rider.minutes ? `${(race.distanceKm / (rider.minutes / 60)).toFixed(1)} km/h` : "n/a";
  const lines = [
    `${race.title} - bib ${rider.bib}`,
    `${rider.name} (${rider.city || "unknown city"}, ${rider.country || "country n/a"})`,
    "",
    `Official time: ${hhmm(rider.minutes)}`,
    `Start: ${rider.startClock || "n/a"}`,
    `Finish: ${rider.finishClock || "n/a"}`,
    `Average speed: ${speed}`,
    "",
    `Fastest: ${hhmm(stats.fastest)}`,
    `Median: ${hhmm(stats.median)}`,
    `Slowest: ${hhmm(stats.slowest)}`,
  ];
  if (rank && rider.minutes !== null) {
    const slower = fieldSize - rank;
    lines.push(`Rank by time: ${rank} of ${fieldSize}`);
    lines.push(`Faster than ${((slower / fieldSize) * 100).toFixed(1)}% of ${race.comparison.label}`);
  } else {
    lines.push("Rank by time: DNF / no official finish");
  }
  lines.push("", `Starters: ${race.officialCounts.starters}`, `Finishers: ${race.officialCounts.finishers}`, `DNF: ${race.officialCounts.dnf}`);
  if (evolution) {
    lines.push("", "Race evolution");
    lines.push(`Timing-mat estimate: you overtook ${evolution.youOvertook}; ${evolution.theyOvertook} overtook you.`);
    for (const point of evolution.positions) lines.push(`${point.place}: estimated position ${point.position}`);
  }
  lines.push("", "Source: official Vatternrundan result pages. Overtakes are inferred from checkpoint timing order changes, not GPS.");
  return lines.join("\n");
}

function metric(label, value, tone = "blue") {
  return `<div class="metric metric-${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}

function renderTabs() {
  els.tabs.innerHTML = state.races
    .map((race) => `<button type="button" class="${race.id === state.raceId ? "active" : ""}" data-race="${esc(race.id)}">${esc(race.label)}</button>`)
    .join("");
  els.tabs.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.raceId = button.dataset.race;
      state.selectedPid = null;
      state.query = "";
      els.search.value = "";
      render();
    });
  });
}

function renderResults(race, selected) {
  const results = searchRiders(race, state.query);
  els.results.innerHTML = results
    .map((rider) => `<button type="button" class="${selected && selected.participantId === rider.participantId ? "selected" : ""}" data-pid="${rider.participantId}"><strong>${rider.bib}</strong><span>${esc(rider.name)}</span><em>${esc(rider.city || "n/a")} · ${esc(rider.country || "n/a")}</em></button>`)
    .join("");
  els.results.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedPid = Number(button.dataset.pid);
      const rider = race.ridersByPid.get(state.selectedPid);
      state.query = String(rider.bib);
      els.search.value = state.query;
      render();
    });
  });
}

function renderSelected(race, rider) {
  if (!rider) {
    els.selected.innerHTML = `<section class="empty-band"><h2>${esc(race ? race.title : "Loading result data")}</h2><p>${race ? `${race.riders.length.toLocaleString()} public entries loaded.` : "Preparing lookup."}</p></section>`;
    return;
  }

  const comparison = comparisonRiders(race, rider);
  const values = comparison.map((item) => item.minutes);
  const stats = statBlock(values);
  const rank = rider.minutes !== null ? values.filter((value) => value < rider.minutes).length + 1 : null;
  const fasterThan = rank && values.length ? (((values.length - rank) / values.length) * 100).toFixed(1) : null;
  const speed = rider.minutes ? (race.distanceKm / (rider.minutes / 60)).toFixed(1) : null;
  const evolution = sortSegments(race, buildEvolution(race, rider));
  const reportText = buildReportText(race, rider, stats, rank, values.length, evolution);
  const countries = countryRows(race, rider);
  const finishRate = ((race.officialCounts.finishers / race.officialCounts.starters) * 100).toFixed(2);

  const countryHtml = `<table class="country-table"><thead><tr><th>Country</th><th>Entries</th><th>Finishers</th><th>Rate</th><th>Mean</th></tr></thead><tbody>${countries
    .map((row) => `<tr><td>${esc(row.country)}</td><td>${row.entries}</td><td>${row.finishers}</td><td>${row.entries ? ((row.finishers / row.entries) * 100).toFixed(1) : "0.0"}%</td><td>${hhmm(row.finishers ? row.total / row.finishers : null)}</td></tr>`)
    .join("")}</tbody></table>`;

  els.selected.innerHTML = `
    <section class="summary-band">
      <div class="rider-title">
        <span>${esc(race.title)}</span>
        <h2>Bib ${rider.bib} · ${esc(rider.name)}</h2>
        <p>${esc(rider.city || "Unknown city")} · ${esc(rider.country || "Country n/a")} · ${rider.finished ? "Finisher" : "DNF / no official finish"}</p>
      </div>
      <div class="official-time"><span>Official time</span><strong>${hhmm(rider.minutes)}</strong></div>
    </section>
    <section class="metrics-grid">
      ${metric("Start", rider.startClock || "n/a")}
      ${metric("Finish", rider.finishClock || "n/a")}
      ${metric("Average speed", speed ? `${speed} km/h` : "n/a", "green")}
      ${metric("Fastest", hhmm(stats.fastest), "amber")}
      ${metric("Median", hhmm(stats.median), "violet")}
      ${metric("Slowest", hhmm(stats.slowest), "red")}
      ${metric(`Rank by time (${race.comparison.label})`, rank ? `${rank} / ${values.length}` : "n/a")}
      ${metric("Faster than", fasterThan ? `${fasterThan}%` : "n/a", "green")}
      ${metric("DNF", race.officialCounts.dnf, "red")}
    </section>
    <section class="content-grid">
      <div class="panel chart-panel">
        <div class="panel-heading"><h3>Finish-time histogram</h3><p>${values.length.toLocaleString()} ${esc(race.comparison.label)}</p></div>
        ${histogramSvg(values, [
          { label: "Your ride", value: rider.minutes, color: "#6d42e8" },
          { label: "Median", value: stats.median, color: "#c43131" },
          { label: "Top 25%", value: stats.q25, color: "#23824f" },
          { label: "Top 10%", value: stats.q10, color: "#d97706" },
        ])}
      </div>
      <div class="panel">
        <div class="panel-heading"><h3>Race evolution</h3><p>${evolution ? `${evolution.youOvertook.toLocaleString()} overtaken · ${evolution.theyOvertook.toLocaleString()} passed you` : "No checkpoint detail"}</p></div>
        ${evolutionSvg(evolution)}
      </div>
    </section>
    <section class="lower-grid">
      <div class="panel compact-panel">
        <h3>Field</h3>
        <div class="field-table">
          <span>Official starters</span><strong>${race.officialCounts.starters.toLocaleString()}</strong>
          <span>Official finishers</span><strong>${race.officialCounts.finishers.toLocaleString()}</strong>
          <span>DNF</span><strong>${race.officialCounts.dnf.toLocaleString()}</strong>
          <span>Finish rate</span><strong>${finishRate}%</strong>
          <span>Mean</span><strong>${hhmm(stats.mean)}</strong>
          <span>Std dev</span><strong>${hhmm(stats.spread)}</strong>
        </div>
        <p class="fine-print">Std dev = standard deviation, the typical spread around the average.</p>
        ${countryHtml}
      </div>
      <div class="panel report-panel">
        <div class="panel-heading"><h3>Text report</h3><button id="copy-report" type="button">Copy</button></div>
        <pre>${esc(reportText)}</pre>
      </div>
    </section>
    <p class="source-note">${esc(race.source)} Overtakes are inferred from relative checkpoint timing order changes during the selected rider's race window, not GPS.</p>
  `;

  document.getElementById("copy-report").addEventListener("click", async (event) => {
    await navigator.clipboard.writeText(reportText);
    event.currentTarget.textContent = "Copied";
    setTimeout(() => {
      event.currentTarget.textContent = "Copy";
    }, 1400);
  });

  const params = new URLSearchParams();
  params.set("race", race.id);
  params.set("bib", String(rider.bib));
  window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
}

function render() {
  const race = currentRace();
  const selected = selectedRider(race);
  renderTabs();
  renderResults(race, selected);
  renderSelected(race, selected);
}

els.search.addEventListener("input", () => {
  const race = currentRace();
  state.query = els.search.value;
  state.selectedPid = null;
  if (race) {
    const cleaned = normalize(state.query);
    const exactBib = /^\d+$/.test(state.query.trim())
      ? race.riders.find((rider) => String(rider.bib) === state.query.trim())
      : null;
    const exactName = race.riders.find((rider) => normalize(rider.name) === cleaned);
    const matches = searchRiders(race, state.query);
    const automatic = exactBib || exactName || (cleaned.length > 2 && matches.length === 1 ? matches[0] : null);
    if (automatic) state.selectedPid = automatic.participantId;
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
    if (state.races.some((race) => race.id === requestedRace)) state.raceId = requestedRace;
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
