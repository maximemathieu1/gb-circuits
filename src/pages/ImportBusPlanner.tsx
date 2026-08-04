// src/pages/ImportBusPlanner.tsx
import React, { useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { useNavigate } from "react-router-dom";

import { importBusPlanner } from "../lib/CircuitService";

const MAX_GPS_FILE_BYTES = 3 * 1024 * 1024;
const MAX_XLS_FILE_BYTES = 10 * 1024 * 1024;
const MAX_POINTS = 1500;
const MAX_XLS_FILES = 4;

type TCode = "B" | "C" | "S";
type ImportStatus =
  | "idle"
  | "reading"
  | "ready"
  | "importing"
  | "success"
  | "error";

type ParsedStop = {
  idx: number;
  lat: number;
  lng: number;
  routeId: string;
  label: string | null;
  stopId: string | null;
  description: string | null;
};

type DirectionStop = {
  ordre: number;
  heure: string | null;
  description: string;
};

type RouteAnchor = {
  ordre: number;
  kind: "stop" | "turnaround" | "maneuver";
  description: string;
  city?: string | null;
  action?: string | null;
};

type ParsedRun = {
  file: File;
  fileName: string;
  circuitNo: string;
  runId: string;
  description: string;
  schoolCode: string | null;
  periode: "AM" | "PM" | "AUTRE";
  heureDepart: string | null;
  heureFin: string | null;
  distanceKm: number | null;
  directionStops: DirectionStop[];
  routeAnchors: RouteAnchor[];
  matchedPoints: ParsedStop[];
  tracePoints: ParsedStop[];
  unmatchedStops: DirectionStop[];
};

type ImportResp = {
  ok?: boolean;
  circuit_id?: string;
  version_id?: string;
  circuit_name?: string;
  route_id?: string;
  points_imported?: number;
  trace_points?: number;
  distance_m?: number | null;
  distance_km?: number | null;
  trace_generated?: boolean;
  warning?: string | null;
};

type ImportedRunResult = {
  run: ParsedRun;
  response: ImportResp;
};

const input: React.CSSProperties = {
  minHeight: 42,
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #cbd5e1",
  background: "#fff",
  color: "#0f172a",
  font: "inherit",
  boxSizing: "border-box",
};

const select: React.CSSProperties = { ...input };

function btn(kind: "primary" | "ghost"): React.CSSProperties {
  return {
    minHeight: 40,
    padding: "9px 14px",
    borderRadius: 12,
    border:
      kind === "primary" ? "1px solid #1d4ed8" : "1px solid #cbd5e1",
    background: kind === "primary" ? "#2563eb" : "#fff",
    color: kind === "primary" ? "#fff" : "#0f172a",
    fontWeight: 900,
    cursor: "pointer",
  };
}

function normalizeHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function cleanCell(value: unknown) {
  return String(value ?? "").replace(/^\uFEFF/, "").trim();
}

function parseNumber(value: unknown) {
  const n = Number(cleanCell(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function detectDelimiter(headerLine: string) {
  if (headerLine.includes("\t")) return "\t";
  if (headerLine.includes(";")) return ";";
  if (headerLine.includes(",")) return ",";
  return "\t";
}

function splitDelimitedLine(line: string, delimiter: string) {
  const output: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (character === delimiter && !quoted) {
      output.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  output.push(current);
  return output;
}

function parseBusPlannerGpsFile(text: string): {
  points: ParsedStop[];
  routeIds: string[];
  errors: string[];
} {
  const rawLines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);

  if (rawLines.length < 2) {
    throw new Error("Le fichier GPS est vide.");
  }

  const delimiter = detectDelimiter(rawLines[0]);
  const headers = splitDelimitedLine(rawLines[0], delimiter).map(normalizeHeader);

  const latIndex = headers.findIndex((header) =>
    ["latitude", "lat"].includes(header)
  );
  const lngIndex = headers.findIndex((header) =>
    ["longitude", "lng", "lon", "long"].includes(header)
  );
  const routeIndex = headers.findIndex((header) =>
    ["routeid", "route", "circuit", "circuitid"].includes(header)
  );
  const locationIndex = headers.findIndex((header) =>
    ["location", "adresse", "address", "description"].includes(header)
  );
  const stopIdIndex = headers.findIndex((header) =>
    ["stopid", "stopidentifier", "identificateurdelarret"].includes(header)
  );
  const descriptionIndex = headers.findIndex((header) =>
    ["description", "stopdescription", "descriptiondelarret"].includes(header)
  );

  const missing: string[] = [];
  if (latIndex < 0) missing.push("Latitude");
  if (lngIndex < 0) missing.push("Longitude");
  if (routeIndex < 0) missing.push("RouteID");
  if (locationIndex < 0) missing.push("Location");
  if (stopIdIndex < 0) missing.push("StopID");

  if (missing.length) {
    throw new Error(`Colonnes GPS manquantes : ${missing.join(", ")}.`);
  }

  const points: ParsedStop[] = [];
  const errors: string[] = [];

  for (let lineIndex = 1; lineIndex < rawLines.length; lineIndex += 1) {
    const cells = splitDelimitedLine(rawLines[lineIndex], delimiter);
    const lat = parseNumber(cells[latIndex]);
    const lng = parseNumber(cells[lngIndex]);
    const routeId = cleanCell(cells[routeIndex]);
    const label = cleanCell(cells[locationIndex]) || null;
    const stopId = cleanCell(cells[stopIdIndex]) || null;
    const description =
      descriptionIndex >= 0 ? cleanCell(cells[descriptionIndex]) || null : null;

    if (lat == null || lng == null) {
      errors.push(`Ligne ${lineIndex + 1} ignorée : coordonnées invalides.`);
      continue;
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      errors.push(`Ligne ${lineIndex + 1} ignorée : coordonnées hors limites.`);
      continue;
    }

    if (!routeId) {
      errors.push(`Ligne ${lineIndex + 1} ignorée : RouteID manquant.`);
      continue;
    }

    points.push({
      idx: points.length + 1,
      lat,
      lng,
      routeId,
      label,
      stopId,
      description,
    });
  }

  if (!points.length) {
    throw new Error("Aucun point GPS valide trouvé.");
  }

  if (points.length > MAX_POINTS) {
    throw new Error(`Le fichier GPS contient plus de ${MAX_POINTS} points.`);
  }

  return {
    points,
    routeIds: [...new Set(points.map((point) => point.routeId))],
    errors,
  };
}

function normalizeText(value: unknown) {
  return cleanCell(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\bsaint[- ]georges\b/g, "")
    .replace(/\bqc\b/g, "")
    .replace(/[;,.:()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function significantTokens(value: string) {
  const ignored = new Set([
    "rue",
    "route",
    "rang",
    "avenue",
    "chemin",
    "est",
    "ouest",
    "nord",
    "sud",
    "de",
    "du",
    "des",
    "la",
    "le",
    "les",
    "et",
    "ecole",
  ]);

  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 1 && !ignored.has(token));
}

function extractFirstNumber(value: string) {
  return normalizeText(value).match(/\b\d+[a-z]?\b/)?.[0] ?? "";
}

function stopMatchScore(description: string, point: ParsedStop) {
  const left = normalizeText(description);
  const right = normalizeText(point.description ?? point.label ?? "");
  if (!left || !right) return 0;
  if (left === right) return 100;
  if (left.includes(right) || right.includes(left)) return 85;

  const leftNumber = extractFirstNumber(left);
  const rightNumber = extractFirstNumber(right);
  const leftTokens = significantTokens(left);
  const rightTokens = new Set(significantTokens(right));

  let score = 0;

  if (leftNumber && rightNumber && leftNumber === rightNumber) {
    score += 55;
  }

  const common = leftTokens.filter((token) => rightTokens.has(token));
  score += common.length * 12;

  // Les destinations scolaires du TXT utilisent souvent le code d’école
  // comme Location (ex.: 084 ou 095).
  const schoolCode = left.match(/\b\d{3}\b/)?.[0];
  if (schoolCode && right === schoolCode) score += 80;

  return score;
}

function pointMatchesSchool(
  point: ParsedStop,
  schoolCode: string | null
) {
  if (!schoolCode) return true;

  const stopId = String(point.stopId ?? "").toUpperCase();
  return stopId.startsWith(`${schoolCode.toUpperCase()}_`);
}

function matchRunStops(
  directionStops: DirectionStop[],
  gpsPoints: ParsedStop[],
  schoolCode: string | null
): {
  matchedPoints: ParsedStop[];
  unmatchedStops: DirectionStop[];
} {
  const candidateIndexes = gpsPoints
    .map((point, index) => ({ point, index }))
    .filter(({ point }) => {
      const stopId = String(point.stopId ?? "").toUpperCase();
      return (
        !stopId.endsWith("_TA") &&
        pointMatchesSchool(point, schoolCode)
      );
    })
    .map(({ index }) => index);

  const remaining = new Set(candidateIndexes);
  const matchedPoints: ParsedStop[] = [];
  const unmatchedStops: DirectionStop[] = [];

  for (const stop of directionStops) {
    let bestIndex = -1;
    let bestScore = 0;

    for (const pointIndex of remaining) {
      const score = stopMatchScore(stop.description, gpsPoints[pointIndex]);

      if (score > bestScore) {
        bestScore = score;
        bestIndex = pointIndex;
      }
    }

    if (bestIndex >= 0 && bestScore >= 45) {
      matchedPoints.push(gpsPoints[bestIndex]);
      remaining.delete(bestIndex);
    } else {
      unmatchedStops.push(stop);
    }
  }

  return { matchedPoints, unmatchedStops };
}

function findBestGpsPoint(
  description: string,
  gpsPoints: ParsedStop[],
  predicate?: (point: ParsedStop) => boolean,
  usedIndexes?: Set<number>
): { point: ParsedStop; index: number } | null {
  let bestIndex = -1;
  let bestScore = 0;

  for (let index = 0; index < gpsPoints.length; index += 1) {
    if (usedIndexes?.has(index)) continue;

    const point = gpsPoints[index];
    if (predicate && !predicate(point)) continue;

    const score = stopMatchScore(description, point);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  if (bestIndex < 0 || bestScore < 45) return null;

  return {
    point: gpsPoints[bestIndex],
    index: bestIndex,
  };
}

function getMapboxToken() {
  return String(
    (import.meta as any).env?.VITE_MAPBOX_TOKEN ||
      (import.meta as any).env?.VITE_MAPBOX_ACCESS_TOKEN ||
      ""
  ).trim();
}

function gpsCenter(points: ParsedStop[]) {
  if (!points.length) return null;

  const total = points.reduce(
    (sum, point) => ({
      lat: sum.lat + point.lat,
      lng: sum.lng + point.lng,
    }),
    { lat: 0, lng: 0 }
  );

  return {
    lat: total.lat / points.length,
    lng: total.lng / points.length,
  };
}

async function geocodeRouteAnchor(
  anchor: RouteAnchor,
  gpsPoints: ParsedStop[]
): Promise<ParsedStop | null> {
  const token = getMapboxToken();
  if (!token) return null;

  const center = gpsCenter(gpsPoints);
  const queryParts = [
    anchor.description,
    anchor.city,
    "Québec",
    "Canada",
  ].filter(Boolean);

  const params = new URLSearchParams({
    q: queryParts.join(", "),
    access_token: token,
    country: "ca",
    language: "fr",
    limit: "1",
    autocomplete: "false",
  });

  if (center) {
    params.set("proximity", `${center.lng},${center.lat}`);
  }

  const response = await fetch(
    `https://api.mapbox.com/search/geocode/v6/forward?${params.toString()}`
  );

  if (!response.ok) return null;

  const payload = await response.json().catch(() => null);
  const coordinates = payload?.features?.[0]?.geometry?.coordinates;

  if (
    !Array.isArray(coordinates) ||
    !Number.isFinite(Number(coordinates[0])) ||
    !Number.isFinite(Number(coordinates[1]))
  ) {
    return null;
  }

  return {
    idx: -1,
    lng: Number(coordinates[0]),
    lat: Number(coordinates[1]),
    routeId: "",
    label: anchor.description,
    stopId: null,
    description: `${anchor.action ?? "Manœuvre"} — ${anchor.description}`,
  };
}

async function resolveRouteTracePoints(
  anchors: RouteAnchor[],
  gpsPoints: ParsedStop[],
  schoolCode: string | null
): Promise<ParsedStop[]> {
  const tracePoints: ParsedStop[] = [];
  const usedStopIndexes = new Set<number>();

  function pushUnique(point: ParsedStop) {
    const previous = tracePoints[tracePoints.length - 1];

    if (
      previous &&
      Math.abs(previous.lat - point.lat) < 0.000001 &&
      Math.abs(previous.lng - point.lng) < 0.000001
    ) {
      return;
    }

    tracePoints.push(point);
  }

  for (const anchor of anchors) {
    if (anchor.kind === "turnaround") {
      const matched = findBestGpsPoint(
        anchor.description,
        gpsPoints,
        (point) =>
          String(point.stopId ?? "").toUpperCase().endsWith("_TA") ||
          normalizeText(point.description ?? "").startsWith("demi tour")
      );

      if (matched) pushUnique(matched.point);
      continue;
    }

    if (anchor.kind === "stop") {
      const matched = findBestGpsPoint(
        anchor.description,
        gpsPoints,
        (point) =>
          !String(point.stopId ?? "").toUpperCase().endsWith("_TA") &&
          pointMatchesSchool(point, schoolCode),
        usedStopIndexes
      );

      if (matched) {
        pushUnique(matched.point);
        usedStopIndexes.add(matched.index);
      }
      continue;
    }

    // Les virages importants servent de points de contrainte lorsque le TXT
    // n'a pas déjà une coordonnée correspondante.
    const existingGpsPoint = findBestGpsPoint(
      anchor.description,
      gpsPoints,
      (point) =>
        normalizeText(point.description ?? point.label ?? "").includes(
          normalizeText(anchor.description)
        )
    );

    if (existingGpsPoint) {
      pushUnique(existingGpsPoint.point);
      continue;
    }

    const geocoded = await geocodeRouteAnchor(anchor, gpsPoints);
    if (geocoded) pushUnique(geocoded);
  }

  return tracePoints;
}

function findDirectionsSection(rows: unknown[][]) {
  const parcoursRowIndex = rows.findIndex((row) =>
    row.some((cell) => normalizeText(cell) === "parcours")
  );

  if (parcoursRowIndex < 0) {
    return { parcoursRowIndex: -1, headerRowIndex: -1 };
  }

  const headerRowIndex = rows.findIndex((row, index) => {
    if (index <= parcoursRowIndex) return false;

    const normalized = row.map(normalizeText);
    return (
      normalized.includes("temps") &&
      normalized.includes("mesure") &&
      normalized.some((cell) => cell.startsWith("description"))
    );
  });

  return { parcoursRowIndex, headerRowIndex };
}

function parseTimeValue(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getHours()).padStart(2, "0")}:${String(
      value.getMinutes()
    ).padStart(2, "0")}`;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const totalMinutes = Math.round((value % 1) * 24 * 60);
    return `${String(Math.floor(totalMinutes / 60) % 24).padStart(
      2,
      "0"
    )}:${String(totalMinutes % 60).padStart(2, "0")}`;
  }

  const text = cleanCell(value);
  const match = text.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);

  if (/pm/i.test(text) && hour < 12) hour += 12;
  if (/am/i.test(text) && hour === 12) hour = 0;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function periodFromTime(time: string | null): "AM" | "PM" | "AUTRE" {
  if (!time) return "AUTRE";
  const hour = Number(time.slice(0, 2));
  if (!Number.isFinite(hour)) return "AUTRE";
  return hour < 12 ? "AM" : "PM";
}

function parseDistanceKm(value: unknown) {
  const text = cleanCell(value).replace(",", ".");
  const match = text.match(/(\d+(?:\.\d+)?)\s*km/i);
  return match ? Number(match[1]) : null;
}

function htmlTableToRows(html: string): unknown[][] {
  const parser = new DOMParser();
  const document = parser.parseFromString(html, "text/html");
  const table = document.querySelector("table");

  if (!table) {
    throw new Error("Aucun tableau HTML trouvé dans le fichier BusPlanner.");
  }

  return Array.from(table.querySelectorAll("tr")).map((row) =>
    Array.from(row.querySelectorAll("th,td")).map((cell) =>
      String(cell.textContent ?? "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    )
  );
}

function xmlSpreadsheetToRows(xmlText: string): unknown[][] {
  const parser = new DOMParser();
  const document = parser.parseFromString(xmlText, "application/xml");

  if (document.querySelector("parsererror")) {
    throw new Error("Le contenu XML du fichier BusPlanner est invalide.");
  }

  const rowNodes = Array.from(
    document.getElementsByTagNameNS("*", "Row")
  );

  if (!rowNodes.length) {
    throw new Error("Aucune ligne SpreadsheetML trouvée.");
  }

  return rowNodes.map((rowNode) => {
    const cells = Array.from(
      rowNode.getElementsByTagNameNS("*", "Cell")
    );

    const row: unknown[] = [];
    let currentIndex = 0;

    for (const cell of cells) {
      const explicitIndex =
        cell.getAttribute("ss:Index") ??
        cell.getAttributeNS(
          "urn:schemas-microsoft-com:office:spreadsheet",
          "Index"
        );

      if (explicitIndex) {
        currentIndex = Math.max(0, Number(explicitIndex) - 1);
      }

      const dataNode = cell.getElementsByTagNameNS("*", "Data")[0];
      row[currentIndex] = String(dataNode?.textContent ?? "").trim();
      currentIndex += 1;
    }

    return row;
  });
}

function delimitedTextToRows(text: string): unknown[][] {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);

  if (!normalized.length) {
    throw new Error("Le fichier Directions est vide.");
  }

  const delimiter = detectDelimiter(normalized[0]);
  return normalized.map((line) => splitDelimitedLine(line, delimiter));
}

async function readBusPlannerDirectionRows(file: File): Promise<unknown[][]> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Les exports BusPlanner portent souvent l'extension .xls, mais contiennent
  // réellement du HTML ou du XML. C'est aussi pourquoi Excel affiche un
  // avertissement sur l'extension.
  let text: string;

  // Les exports Directions de BusPlanner sont des fichiers texte UTF-16
  // délimités par tabulations, même s'ils portent l'extension .xls.
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    text = new TextDecoder("utf-16le").decode(bytes);
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    text = new TextDecoder("utf-16be").decode(bytes);
  } else {
    text = new TextDecoder("utf-8").decode(bytes);

    if (text.includes("\uFFFD")) {
      try {
        text = new TextDecoder("windows-1252").decode(bytes);
      } catch {
        // UTF-8 demeure le repli.
      }
    }
  }

  const beginning = text.trimStart().slice(0, 500).toLowerCase();

  if (
    beginning.startsWith("<!doctype html") ||
    beginning.startsWith("<html") ||
    beginning.includes("<table")
  ) {
    return htmlTableToRows(text);
  }

  if (
    beginning.startsWith("<?xml") ||
    beginning.includes("<workbook") ||
    beginning.includes("<worksheet")
  ) {
    return xmlSpreadsheetToRows(text);
  }

  // Dernier repli pour un export tabulé/CSV qui aurait une extension .xls.
  if (text.includes("\t") || text.includes(";") || text.includes(",")) {
    return delimitedTextToRows(text);
  }

  throw new Error(
    `${file.name} n'est pas un export BusPlanner HTML/XML lisible.`
  );
}

function valueAfterLabel(row: unknown[], label: string) {
  const normalizedLabel = normalizeText(label);

  for (let index = 0; index < row.length; index += 1) {
    if (normalizeText(row[index]) === normalizedLabel) {
      return cleanCell(row[index + 1]);
    }
  }

  return "";
}

function removeBusPlannerLoadSuffix(value: string) {
  return value
    .replace(/\s*\(\d+\)\s*(?:\(C\))?\s*$/i, "")
    .replace(/\s*\(C\)\s*$/i, "")
    .trim();
}

async function parseDirectionsXls(
  file: File,
  gpsPoints: ParsedStop[]
): Promise<ParsedRun> {
  if (!/\.(xls|xlsx)$/i.test(file.name)) {
    throw new Error(`${file.name} n’est pas un fichier XLS/XLSX.`);
  }

  if (file.size > MAX_XLS_FILE_BYTES) {
    throw new Error(`${file.name} dépasse 10 Mo.`);
  }

  const rows = await readBusPlannerDirectionRows(file);
  const { parcoursRowIndex, headerRowIndex } = findDirectionsSection(rows);

  if (parcoursRowIndex < 0) {
    throw new Error(`${file.name} : ligne « Parcours » introuvable.`);
  }

  if (headerRowIndex < 0) {
    throw new Error(
      `${file.name} : tableau Directions introuvable (Temps / Mesure / Description).`
    );
  }

  const parcoursRow = rows[parcoursRowIndex];
  const summaryRow = rows[parcoursRowIndex + 1] ?? [];
  const schoolRow = rows[parcoursRowIndex + 2] ?? [];

  const circuitNo =
    valueAfterLabel(rows[0] ?? [], "Circuit") ||
    file.name.match(/^(\d+)/)?.[1] ||
    "";

  const runId =
    valueAfterLabel(parcoursRow, "Parcours") ||
    file.name.match(/_(\d{4,})_/i)?.[1] ||
    file.name.replace(/\.(xls|xlsx)$/i, "");

  const schoolText = valueAfterLabel(schoolRow, "Écoles");
  const description =
    valueAfterLabel(parcoursRow, "Description") ||
    schoolText;

  const schoolCode =
    schoolText.match(/\b(\d{3})\b/)?.[1] ??
    description.match(/\b(\d{3})\b/)?.[1] ??
    null;

  const summaryText = summaryRow.map(cleanCell).join(" ");
  const timeRange = summaryText.match(
    /(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/
  );
  const heureDepart = timeRange?.[1] ?? null;
  const heureFin = timeRange?.[2] ?? null;
  const distanceKm = parseDistanceKm(summaryText);

  const header = rows[headerRowIndex].map(normalizeText);
  const timeIndex = header.findIndex((cell) => cell === "temps");
  const measureIndex = header.findIndex((cell) => cell === "mesure");
  const descriptionIndex = header.findIndex((cell) =>
    cell.startsWith("description")
  );
  const cityIndex = header.findIndex((cell) => cell === "ville");

  if (measureIndex < 0 || descriptionIndex < 0) {
    throw new Error(
      `${file.name} : colonnes Mesure/Description manquantes.`
    );
  }

  const directionStops: DirectionStop[] = [];
  const routeAnchors: RouteAnchor[] = [];
  let routeAnchorOrder = 0;

  for (
    let rowIndex = headerRowIndex + 1;
    rowIndex < rows.length;
    rowIndex += 1
  ) {
    const row = rows[rowIndex];
    const measure = cleanCell(row[measureIndex]);
    const rawDescription = cleanCell(row[descriptionIndex]);
    const descriptionCell = removeBusPlannerLoadSuffix(rawDescription);

    // La section du parcours se termine au prochain « Déplacement à vide ».
    if (normalizeText(row[0]) === "deplacement a vide") break;

    if (!descriptionCell) continue;

    const stopMatch = measure.match(/^arr[êe]t\s*(\d+)/i);

    if (stopMatch) {
      const stop = {
        ordre: Number(stopMatch[1]),
        heure: timeIndex >= 0 ? parseTimeValue(row[timeIndex]) : null,
        description: descriptionCell,
      };

      directionStops.push(stop);
      routeAnchors.push({
        ordre: routeAnchorOrder++,
        kind: "stop",
        description: descriptionCell,
        city: cityIndex >= 0 ? cleanCell(row[cityIndex]) || null : null,
        action: measure,
      });
      continue;
    }

    if (/^demi\s*tour/i.test(measure)) {
      routeAnchors.push({
        ordre: routeAnchorOrder++,
        kind: "turnaround",
        description: descriptionCell,
        city: cityIndex >= 0 ? cleanCell(row[cityIndex]) || null : null,
        action: measure,
      });
      continue;
    }

    if (/^(gauche|droite|direct)\b/i.test(measure)) {
      routeAnchors.push({
        ordre: routeAnchorOrder++,
        kind: "maneuver",
        description: descriptionCell,
        city: cityIndex >= 0 ? cleanCell(row[cityIndex]) || null : null,
        action: measure,
      });
    }
  }

  if (!directionStops.length) {
    throw new Error(`${file.name} : aucun arrêt détecté dans les Directions.`);
  }

  directionStops.sort((a, b) => a.ordre - b.ordre);

  const matched = matchRunStops(
    directionStops,
    gpsPoints,
    schoolCode
  );

  // Les manœuvres sont géocodées seulement au moment de l'import.
  const tracePoints = matched.matchedPoints;

  return {
    file,
    fileName: file.name,
    circuitNo,
    runId,
    description,
    schoolCode,
    periode: periodFromTime(heureDepart),
    heureDepart,
    heureFin,
    distanceKm,
    directionStops,
    routeAnchors,
    matchedPoints: matched.matchedPoints,
    tracePoints,
    unmatchedStops: matched.unmatchedStops,
  };
}

function formatKm(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)} km`;
}

export default function ImportBusPlanner() {
  const navigate = useNavigate();
  const gpsInputRef = useRef<HTMLInputElement | null>(null);
  const xlsInputRef = useRef<HTMLInputElement | null>(null);

  const [transporteur, setTransporteur] = useState<TCode>("B");

  const [gpsFileName, setGpsFileName] = useState("");
  const [routeId, setRouteId] = useState("");
  const [gpsPoints, setGpsPoints] = useState<ParsedStop[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);

  const [xlsFiles, setXlsFiles] = useState<File[]>([]);
  const [runs, setRuns] = useState<ParsedRun[]>([]);

  const [generateTrace, setGenerateTrace] = useState(true);
  const [status, setStatus] = useState<ImportStatus>("idle");
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<ImportedRunResult[]>([]);
  const [draggingGps, setDraggingGps] = useState(false);
  const [draggingXls, setDraggingXls] = useState(false);

  const gpsPreview = useMemo(() => gpsPoints.slice(0, 6), [gpsPoints]);

  const canImport =
    status !== "importing" &&
    gpsPoints.length >= 2 &&
    runs.length >= 1 &&
    runs.length <= MAX_XLS_FILES &&
    runs.every((run) => run.matchedPoints.length >= 2);

  async function readGpsFile(file: File) {
    setStatus("reading");
    setMessage("Lecture du fichier GPS…");
    setResults([]);

    try {
      if (!/\.(txt|csv)$/i.test(file.name)) {
        throw new Error("Sélectionne un fichier GPS .txt ou .csv.");
      }

      if (file.size > MAX_GPS_FILE_BYTES) {
        throw new Error("Le fichier GPS dépasse 3 Mo.");
      }

      const parsed = parseBusPlannerGpsFile(await file.text());

      setGpsFileName(file.name);
      setGpsPoints(parsed.points);
      setRouteId(parsed.routeIds[0] ?? "");
      setParseErrors(parsed.errors);

      if (xlsFiles.length) {
        const parsedRuns = await Promise.all(
          xlsFiles.map((xlsFile) => parseDirectionsXls(xlsFile, parsed.points))
        );
        setRuns(parsedRuns);
      }

      setStatus("ready");
      setMessage(`${parsed.points.length} points GPS détectés.`);
    } catch (error: any) {
      setGpsFileName(file.name);
      setGpsPoints([]);
      setRouteId("");
      setRuns([]);
      setStatus("error");
      setMessage(error?.message ?? "Impossible de lire le fichier GPS.");
    }
  }

  async function readXlsFiles(files: File[]) {
    setStatus("reading");
    setMessage("Lecture des parcours XLS…");
    setResults([]);

    try {
      if (!gpsPoints.length) {
        throw new Error("Sélectionne d’abord le fichier GPS.");
      }

      if (!files.length) {
        throw new Error("Sélectionne au moins un fichier XLS.");
      }

      const mergedFiles = [...xlsFiles];

      for (const file of files) {
        const alreadyAdded = mergedFiles.some(
          (existing) =>
            existing.name === file.name &&
            existing.size === file.size &&
            existing.lastModified === file.lastModified
        );

        if (!alreadyAdded) {
          mergedFiles.push(file);
        }
      }

      if (mergedFiles.length > MAX_XLS_FILES) {
        throw new Error(
          `Tu peux importer un maximum de ${MAX_XLS_FILES} fichiers XLS à la fois.`
        );
      }

      const parsedRuns = await Promise.all(
        mergedFiles.map((file) => parseDirectionsXls(file, gpsPoints))
      );

      setXlsFiles(mergedFiles);
      setRuns(parsedRuns);
      setStatus("ready");
      setMessage(`${parsedRuns.length} parcours XLS détecté(s).`);

      // Permet de sélectionner ensuite un autre fichier, même depuis le même input.
      if (xlsInputRef.current) {
        xlsInputRef.current.value = "";
      }
    } catch (error: any) {
      setStatus("error");
      setMessage(error?.message ?? "Impossible de lire les fichiers XLS.");
    }
  }

  function onGpsFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void readGpsFile(file);
  }

  function onXlsFilesChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    void readXlsFiles(files);
  }

  function onGpsDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDraggingGps(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void readGpsFile(file);
  }

  function onXlsDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDraggingXls(false);
    const files = Array.from(event.dataTransfer.files ?? []).filter((file) =>
      /\.(xls|xlsx)$/i.test(file.name)
    );
    void readXlsFiles(files);
  }

  function resetImport() {
    setGpsFileName("");
    setRouteId("");
    setGpsPoints([]);
    setParseErrors([]);
    setXlsFiles([]);
    setRuns([]);
    setStatus("idle");
    setMessage("");
    setResults([]);

    if (gpsInputRef.current) gpsInputRef.current.value = "";
    if (xlsInputRef.current) xlsInputRef.current.value = "";
  }

  async function runImport() {
    if (!canImport) return;

    setStatus("importing");
    setMessage(`Import de ${runs.length} parcours…`);
    setResults([]);

    try {
      const imported: ImportedRunResult[] = [];

      for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
        const run = runs[runIndex];

        setMessage(
          `Préparation de la trace ${runIndex + 1}/${runs.length} — ${run.runId} ${run.periode}…`
        );

        const resolvedTracePoints = generateTrace
          ? await resolveRouteTracePoints(
              run.routeAnchors,
              gpsPoints,
              run.schoolCode
            )
          : run.matchedPoints;

        const circuitName = `${run.runId}${
          run.periode === "AUTRE" ? "" : ` ${run.periode}`
        }`.trim();

        const response = await importBusPlanner({
          transporteur_code: transporteur,
          route_id: run.runId || routeId,
          circuit_name: circuitName,
          replace_existing: true,
          generate_trace: generateTrace,
          points: run.matchedPoints.map((point) => ({
            lat: point.lat,
            lng: point.lng,
            label: point.label,
            stop_id: point.stopId,
          })),
          trace_points: resolvedTracePoints.map((point) => ({
            lat: point.lat,
            lng: point.lng,
            label: point.label,
            stop_id: point.stopId,
          })),
          official_distance_km: run.distanceKm,
        });

        imported.push({ run, response });
      }

      setResults(imported);
      setStatus("success");
      setMessage(`${imported.length} parcours importé(s) avec succès.`);
    } catch (error: any) {
      setStatus("error");
      setMessage(error?.message ?? "Erreur pendant l’import.");
    }
  }

  const page: React.CSSProperties = {
    minHeight: "100vh",
    width: "100%",
    padding: "clamp(14px, 3vw, 28px)",
    boxSizing: "border-box",
    fontFamily:
      "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
    background:
      "radial-gradient(circle at 1px 1px, rgba(59,130,246,.10) 1px, transparent 1px) 0 0 / 14px 14px," +
      "radial-gradient(120% 80% at 50% 25%, rgba(59,130,246,.17), transparent 60%)," +
      "linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%)",
  };

  const shell: React.CSSProperties = {
    width: "min(1080px, 100%)",
    margin: "0 auto",
  };

  const card: React.CSSProperties = {
    borderRadius: 24,
    background: "rgba(255,255,255,.95)",
    border: "1px solid rgba(15,23,42,.07)",
    boxShadow: "0 20px 60px rgba(15,23,42,.11)",
    padding: "clamp(16px, 3vw, 26px)",
  };

  const smallCard: React.CSSProperties = {
    borderRadius: 18,
    border: "1px solid rgba(15,23,42,.08)",
    background: "rgba(248,250,252,.88)",
    padding: 15,
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    marginBottom: 7,
    fontWeight: 900,
    color: "#0f172a",
    fontSize: 13,
  };

  const statusBackground =
    status === "success"
      ? "rgba(5,150,105,.10)"
      : status === "error"
      ? "rgba(220,38,38,.10)"
      : status === "importing" || status === "reading"
      ? "rgba(37,99,235,.10)"
      : "rgba(15,23,42,.05)";

  const statusColor =
    status === "success"
      ? "#047857"
      : status === "error"
      ? "#b91c1c"
      : status === "importing" || status === "reading"
      ? "#1d4ed8"
      : "#475569";

  return (
    <div style={page}>
      <div style={shell}>
        <div style={{ ...card, marginBottom: 16 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 14,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 900, color: "#2563eb" }}>
                GROUPE BRETON
              </div>
              <h1
                style={{
                  margin: "5px 0 0",
                  color: "#0f172a",
                  fontSize: "clamp(25px, 5vw, 38px)",
                  letterSpacing: -1,
                }}
              >
                Importer des parcours BusPlanner
              </h1>
              <div
                style={{
                  marginTop: 8,
                  color: "#64748b",
                  fontWeight: 700,
                }}
              >
                1 fichier GPS TXT et jusqu’à 4 fichiers de parcours XLS.
              </div>
            </div>

            <button
              type="button"
              style={btn("ghost")}
              onClick={() => navigate("/admin/circuits")}
            >
              Retour
            </button>
          </div>
        </div>

        <div style={card}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 14,
            }}
          >
            <div>
              <label style={labelStyle}>1. Fichier GPS BusPlanner</label>
              <div
                style={{
                  borderRadius: 20,
                  border: draggingGps
                    ? "2px solid #2563eb"
                    : "2px dashed rgba(37,99,235,.38)",
                  background: draggingGps
                    ? "rgba(37,99,235,.10)"
                    : "rgba(239,246,255,.62)",
                  padding: 24,
                  textAlign: "center",
                  cursor: "pointer",
                }}
                onClick={() => gpsInputRef.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDraggingGps(true);
                }}
                onDragLeave={() => setDraggingGps(false)}
                onDrop={onGpsDrop}
              >
                <input
                  ref={gpsInputRef}
                  type="file"
                  accept=".txt,.csv,text/plain,text/csv"
                  onChange={onGpsFileChange}
                  style={{ display: "none" }}
                />
                <div style={{ fontSize: 36 }}>📍</div>
                <div style={{ marginTop: 8, fontWeight: 950 }}>
                  {gpsFileName || "Déposer le fichier Points GPS"}
                </div>
                <div style={{ marginTop: 5, color: "#64748b", fontSize: 13 }}>
                  Latitude, Longitude, RouteID, Location, StopID
                </div>
              </div>
            </div>

            <div>
              <label style={labelStyle}>
                2. Parcours XLS — maximum {MAX_XLS_FILES}
              </label>
              <div
                style={{
                  borderRadius: 20,
                  border: draggingXls
                    ? "2px solid #2563eb"
                    : "2px dashed rgba(37,99,235,.38)",
                  background: draggingXls
                    ? "rgba(37,99,235,.10)"
                    : "rgba(248,250,252,.88)",
                  padding: 24,
                  textAlign: "center",
                  cursor: gpsPoints.length ? "pointer" : "not-allowed",
                  opacity: gpsPoints.length ? 1 : 0.55,
                }}
                onClick={() => {
                  if (gpsPoints.length) xlsInputRef.current?.click();
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (gpsPoints.length) setDraggingXls(true);
                }}
                onDragLeave={() => setDraggingXls(false)}
                onDrop={onXlsDrop}
              >
                <input
                  ref={xlsInputRef}
                  type="file"
                  accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  multiple
                  onChange={onXlsFilesChange}
                  style={{ display: "none" }}
                />
                <div style={{ fontSize: 36 }}>📄</div>
                <div style={{ marginTop: 8, fontWeight: 950 }}>
                  {xlsFiles.length
                    ? `${xlsFiles.length} fichier(s) sélectionné(s)`
                    : "Ajouter de 1 à 4 fichiers XLS"}
                </div>
                <div style={{ marginTop: 5, color: "#64748b", fontSize: 13 }}>
                  Tu peux les ajouter un à la fois; les fichiers déjà choisis sont conservés.
                </div>
              </div>
            </div>
          </div>

          {message ? (
            <div
              style={{
                marginTop: 14,
                borderRadius: 16,
                padding: "12px 14px",
                background: statusBackground,
                color: statusColor,
                fontWeight: 850,
              }}
            >
              {status === "reading" || status === "importing"
                ? "⏳ "
                : status === "success"
                ? "✓ "
                : status === "error"
                ? "✕ "
                : ""}
              {message}
            </div>
          ) : null}

          {gpsPoints.length ? (
            <div
              style={{
                marginTop: 16,
                display: "grid",
                gridTemplateColumns: "minmax(240px, 420px)",
              }}
            >
              <div>
                <label style={labelStyle}>Transporteur</label>
                <select
                  value={transporteur}
                  onChange={(event) =>
                    setTransporteur(event.target.value as TCode)
                  }
                  style={{ ...select, width: "100%" }}
                  disabled={status === "importing"}
                >
                  <option value="B">Autobus Breton</option>
                  <option value="C">Autobus Champagne</option>
                  <option value="S">Transport Sécuritaire</option>
                </select>
              </div>
            </div>
          ) : null}

          {runs.length ? (
            <>
              <div
                style={{
                  marginTop: 18,
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(235px, 1fr))",
                  gap: 12,
                }}
              >
                {runs.map((run) => {
                  const warning = run.unmatchedStops.length > 0;

                  return (
                    <div
                      key={`${run.fileName}-${run.runId}`}
                      style={{
                        ...smallCard,
                        borderColor: warning ? "#f59e0b" : "#bbf7d0",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 8,
                        }}
                      >
                        <div style={{ fontWeight: 950, fontSize: 18 }}>
                          {run.runId} {run.periode}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <div
                            style={{
                              color: warning ? "#b45309" : "#047857",
                              fontWeight: 900,
                            }}
                          >
                            {warning ? "À vérifier" : "Prêt"}
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              const remainingFiles = xlsFiles.filter(
                                (file) =>
                                  !(
                                    file.name === run.file.name &&
                                    file.size === run.file.size &&
                                    file.lastModified === run.file.lastModified
                                  )
                              );
                              setXlsFiles(remainingFiles);
                              setRuns((current) =>
                                current.filter(
                                  (item) =>
                                    !(
                                      item.file.name === run.file.name &&
                                      item.file.size === run.file.size &&
                                      item.file.lastModified === run.file.lastModified
                                    )
                                )
                              );
                              setMessage(
                                remainingFiles.length
                                  ? `${remainingFiles.length} parcours XLS détecté(s).`
                                  : "Ajoute de 1 à 4 fichiers XLS Directions."
                              );
                            }}
                            disabled={status === "importing"}
                            style={{
                              border: "1px solid #fecaca",
                              background: "#fff",
                              color: "#dc2626",
                              borderRadius: 8,
                              padding: "4px 7px",
                              fontWeight: 900,
                              cursor: "pointer",
                            }}
                            title="Retirer ce fichier"
                          >
                            ✕
                          </button>
                        </div>
                      </div>

                      <div
                        style={{
                          marginTop: 6,
                          color: "#475569",
                          fontWeight: 700,
                        }}
                      >
                        {run.description || run.fileName}
                      </div>

                      <div
                        style={{
                          marginTop: 12,
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: 8,
                          fontSize: 13,
                        }}
                      >
                        <div>
                          <strong>Début :</strong> {run.heureDepart || "—"}
                        </div>
                        <div>
                          <strong>Fin :</strong> {run.heureFin || "—"}
                        </div>
                        <div>
                          <strong>École :</strong>{" "}
                          {run.schoolCode || "—"}
                        </div>
                        <div>
                          <strong>Distance officielle :</strong>{" "}
                          {formatKm(run.distanceKm)}
                        </div>
                        <div>
                          <strong>Arrêts :</strong>{" "}
                          {run.matchedPoints.length}/{run.directionStops.length}
                        </div>
                        <div>
                          <strong>Instructions :</strong>{" "}
                          {run.routeAnchors.length}
                        </div>
                      </div>

                      {warning ? (
                        <div
                          style={{
                            marginTop: 10,
                            color: "#92400e",
                            fontSize: 12,
                            fontWeight: 750,
                          }}
                        >
                          {run.unmatchedStops.length} arrêt(s) du XLS n’ont pas
                          été associés dans le groupe {run.schoolCode || "détecté"} du TXT.
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div
                style={{
                  marginTop: 16,
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(250px, 1fr))",
                  gap: 12,
                }}
              >
                <label
                  style={{
                    ...smallCard,
                    display: "flex",
                    gap: 12,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={generateTrace}
                    onChange={(event) =>
                      setGenerateTrace(event.target.checked)
                    }
                    disabled={status === "importing"}
                    style={{ width: 20, height: 20, marginTop: 2 }}
                  />
                  <span>
                    <span
                      style={{
                        display: "block",
                        fontWeight: 950,
                        color: "#0f172a",
                      }}
                    >
                      Générer la trace Mapbox
                    </span>
                    <span
                      style={{
                        display: "block",
                        marginTop: 4,
                        color: "#64748b",
                        fontWeight: 700,
                      }}
                    >
                      Les arrêts, demi-tours et virages importants du XLS sont utilisés comme contraintes de routage.
                    </span>
                  </span>
                </label>

                <div style={{ ...smallCard, display: "flex", gap: 12 }}>
                  <span style={{ fontSize: 22 }}>🗂️</span>
                  <span>
                    <span
                      style={{
                        display: "block",
                        fontWeight: 950,
                        color: "#0f172a",
                      }}
                    >
                      Nouvelle version automatique
                    </span>
                    <span
                      style={{
                        display: "block",
                        marginTop: 4,
                        color: "#64748b",
                        fontWeight: 700,
                      }}
                    >
                      Les anciennes versions des parcours sont conservées.
                    </span>
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={runImport}
                disabled={!canImport}
                style={{
                  width: "100%",
                  marginTop: 18,
                  border: 0,
                  borderRadius: 18,
                  padding: "16px 18px",
                  background: canImport
                    ? "linear-gradient(135deg, #1d4ed8, #2563eb)"
                    : "#cbd5e1",
                  color: "#fff",
                  fontWeight: 950,
                  fontSize: 17,
                  cursor: canImport ? "pointer" : "not-allowed",
                  boxShadow: canImport
                    ? "0 14px 35px rgba(37,99,235,.25)"
                    : "none",
                }}
              >
                {status === "importing"
                  ? "Import en cours…"
                  : `Importer ${runs.length} parcours`}
              </button>
            </>
          ) : null}

          {gpsPoints.length ? (
            <div style={{ marginTop: 18, ...smallCard }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div style={{ fontWeight: 950, fontSize: 17 }}>
                    Aperçu GPS
                  </div>
                  <div
                    style={{
                      marginTop: 3,
                      color: "#64748b",
                      fontWeight: 700,
                    }}
                  >
                    {gpsFileName} · {routeId || "Route inconnue"} ·{" "}
                    {gpsPoints.length} points
                  </div>
                </div>

                <button
                  type="button"
                  style={btn("ghost")}
                  onClick={resetImport}
                  disabled={status === "importing"}
                >
                  Recommencer
                </button>
              </div>

              <div style={{ marginTop: 12, overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    minWidth: 700,
                    borderCollapse: "collapse",
                    fontSize: 13,
                  }}
                >
                  <thead>
                    <tr style={{ textAlign: "left", color: "#475569" }}>
                      <th style={{ padding: 8 }}>#</th>
                      <th style={{ padding: 8 }}>Latitude</th>
                      <th style={{ padding: 8 }}>Longitude</th>
                      <th style={{ padding: 8 }}>Emplacement</th>
                      <th style={{ padding: 8 }}>StopID</th>
                      <th style={{ padding: 8 }}>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gpsPreview.map((point) => (
                      <tr
                        key={`${point.idx}-${point.lat}-${point.lng}`}
                        style={{ borderTop: "1px solid #e2e8f0" }}
                      >
                        <td style={{ padding: 8, fontWeight: 900 }}>
                          {point.idx}
                        </td>
                        <td style={{ padding: 8 }}>
                          {point.lat.toFixed(7)}
                        </td>
                        <td style={{ padding: 8 }}>
                          {point.lng.toFixed(7)}
                        </td>
                        <td style={{ padding: 8, fontWeight: 700 }}>
                          {point.label || "—"}
                        </td>
                        <td style={{ padding: 8, fontFamily: "monospace" }}>
                          {point.stopId || "—"}
                        </td>
                        <td style={{ padding: 8 }}>
                          {point.description || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {parseErrors.length ? (
                <div
                  style={{
                    marginTop: 10,
                    color: "#92400e",
                    fontSize: 12,
                    fontWeight: 750,
                  }}
                >
                  {parseErrors.length} ligne(s) GPS ignorée(s).
                </div>
              ) : null}
            </div>
          ) : null}

          {status === "success" && results.length ? (
            <div
              style={{
                marginTop: 18,
                borderRadius: 20,
                padding: 18,
                background:
                  "linear-gradient(135deg, rgba(5,150,105,.12), rgba(16,185,129,.06))",
                border: "1px solid rgba(5,150,105,.20)",
              }}
            >
              <div
                style={{
                  fontWeight: 950,
                  fontSize: 20,
                  color: "#065f46",
                }}
              >
                Import terminé
              </div>

              <div
                style={{
                  marginTop: 12,
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(230px, 1fr))",
                  gap: 10,
                }}
              >
                {results.map(({ run, response }) => (
                  <div
                    key={`${run.runId}-${response.version_id}`}
                    style={smallCard}
                  >
                    <div style={{ fontWeight: 950, fontSize: 17 }}>
                      {run.runId} {run.periode}
                    </div>
                    <div style={{ marginTop: 6, color: "#475569" }}>
                      {response.points_imported ?? run.matchedPoints.length}{" "}
                      arrêts · Mapbox {formatKm(response.distance_km)}
                      <br />
                      Officiel BusPlanner : {formatKm(run.distanceKm)}
                    </div>

                    {response.warning ? (
                      <div
                        style={{
                          marginTop: 8,
                          color: "#92400e",
                          fontSize: 12,
                          fontWeight: 750,
                        }}
                      >
                        {response.warning}
                      </div>
                    ) : null}

                    {response.circuit_id ? (
                      <button
                        type="button"
                        style={{ ...btn("primary"), marginTop: 10 }}
                        onClick={() =>
                          navigate(
                            `/admin/circuits/${encodeURIComponent(
                              response.circuit_id!
                            )}`
                          )
                        }
                      >
                        Ouvrir
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
