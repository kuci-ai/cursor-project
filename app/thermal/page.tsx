"use client";
import React, { useMemo, useRef, useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Thermometer, Upload, Palette } from "lucide-react";

/**
 * Next.js (App Router) Thermal CSV Viewer
 * Supports FLIR/FLUKE CSV exports with headers and 480×640 or 320×240 grids.
 * Automatically detects encoding (UTF-8 / UTF-16 variants), skips header lines,
 * removes the first index column, and visualizes the temperature matrix.
 */

function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }

// ------------------------- Color Palettes -------------------------
const palettes = {
  Jet: (v: number): [number, number, number] => {
    v = clamp01(v);
    const r = Math.round(255 * clamp01(1.5 - Math.abs(4 * v - 3)));
    const g = Math.round(255 * clamp01(1.5 - Math.abs(4 * v - 2)));
    const b = Math.round(255 * clamp01(1.5 - Math.abs(4 * v - 1)));
    return [r, g, b];
  },
  Turbo: (v: number): [number, number, number] => {
    v = clamp01(v);
    const r = Math.round(255 * (0.1357 + 4.6154*v - 42.6603*v*v + 132.1311*v**3 - 152.9424*v**4 + 59.2864*v**5));
    const g = Math.round(255 * (0.0914 + 2.1942*v + 4.8430*v*v - 14.1850*v**3 + 4.2773*v**4 + 2.8296*v**5));
    const b = Math.round(255 * (0.1067 + 12.6419*v - 50.6162*v*v + 89.9558*v**3 - 67.7227*v**4 + 18.0590*v**5));
    return [r, g, b];
  },
  Grayscale: (v: number): [number, number, number] => {
    const c = Math.round(clamp01(v) * 255);
    return [c, c, c];
  },
  "Iron Bow": (v: number): [number, number, number] => {
    v = clamp01(v);
    // Iron bow palette - dark blue to white to red
    if (v < 0.5) {
      const s = v * 2;
      const r = Math.floor(0 + s * 255);
      const g = Math.floor(0 + s * 255);
      const b = Math.floor(100 + s * 155);
      return [r, g, b];
    } else {
      const s = (v - 0.5) * 2;
      const r = Math.floor(255);
      const g = Math.floor(255 - s * 255);
      const b = Math.floor(255 - s * 255);
      return [r, g, b];
    }
  },
  "Rainbow": (v: number): [number, number, number] => {
    v = clamp01(v);
    const hue = v * 300;
    const sat = 0.8;
    const val = 0.9;
    const c = val * sat;
    const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
    const m = val - c;
    let r = 0, g = 0, b = 0;
    if (hue < 60) { r = c; g = x; b = 0; }
    else if (hue < 120) { r = x; g = c; b = 0; }
    else if (hue < 180) { r = 0; g = c; b = x; }
    else if (hue < 240) { r = 0; g = x; b = c; }
    else if (hue < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    return [Math.floor((r + m) * 255), Math.floor((g + m) * 255), Math.floor((b + m) * 255)];
  },
  "BlueRed": (v: number): [number, number, number] => {
    v = clamp01(v);
    // Blue to red palette
    const r = Math.floor(v * 255);
    const g = Math.floor((1 - Math.abs(v - 0.5) * 2) * 255);
    const b = Math.floor((1 - v) * 255);
    return [r, g, b];
  },
  "High Contrast": (v: number): [number, number, number] => {
    v = clamp01(v);
    // High contrast black and white
    const intensity = v > 0.5 ? 255 : 0;
    return [intensity, intensity, intensity];
  }
};

// ------------------------- Encoding Detection -------------------------
function hasBOM(buf: Uint8Array, bom: number[]): boolean {
  if (buf.length < bom.length) return false;
  return bom.every((b, i) => buf[i] === b);
}

function decodeBestEffort(buffer: ArrayBuffer): string {
  const u8 = new Uint8Array(buffer);
  
  // Check for BOM markers first
  if (hasBOM(u8, [0xEF, 0xBB, 0xBF])) {
    console.log("Detected UTF-8 BOM");
    return new TextDecoder("utf-8").decode(buffer);
  }
  if (hasBOM(u8, [0xFF, 0xFE])) {
    console.log("Detected UTF-16LE BOM");
    return new TextDecoder("utf-16le").decode(buffer);
  }
  if (hasBOM(u8, [0xFE, 0xFF])) {
    console.log("Detected UTF-16BE BOM");
    return new TextDecoder("utf-16be").decode(buffer);
  }

  // Analyze byte patterns to detect encoding
  let zerosLe = 0, zerosBe = 0, asciiChars = 0;
  const sampleSize = Math.min(u8.length - 1, 4000);
  
  for (let i = 0; i < sampleSize; i += 2) {
    if (u8[i + 1] === 0 && u8[i] !== 0) zerosLe++;
    if (u8[i] === 0 && u8[i + 1] !== 0) zerosBe++;
    if (u8[i] >= 32 && u8[i] <= 126) asciiChars++; // Printable ASCII
  }

  console.log(`Encoding analysis: UTF-16LE zeros: ${zerosLe}, UTF-16BE zeros: ${zerosBe}, ASCII chars: ${asciiChars}`);

  // If we see many null bytes in little-endian pattern, it's likely UTF-16LE
  if (zerosLe > zerosBe && zerosLe > 50) {
    console.log("Detected UTF-16LE by byte pattern");
    return new TextDecoder("utf-16le").decode(buffer);
  }
  
  // If we see many null bytes in big-endian pattern, it's likely UTF-16BE
  if (zerosBe > zerosLe && zerosBe > 50) {
    console.log("Detected UTF-16BE by byte pattern");
    return new TextDecoder("utf-16be").decode(buffer);
  }

  // If we see mostly ASCII characters, it's likely UTF-8
  if (asciiChars > sampleSize * 0.8) {
    console.log("Detected UTF-8 by ASCII content");
    return new TextDecoder("utf-8").decode(buffer);
  }

  // Default to UTF-8, but try UTF-16LE as fallback
  console.log("Defaulting to UTF-8, will try UTF-16LE if parsing fails");
  try {
    const utf8Result = new TextDecoder("utf-8").decode(buffer);
    // Check if the result looks like valid CSV data
    if (utf8Result.includes(',') && utf8Result.includes('\n')) {
      return utf8Result;
    }
  } catch (e) {
    console.log("UTF-8 failed, trying UTF-16LE");
  }

  // Fallback to UTF-16LE
  try {
    return new TextDecoder("utf-16le").decode(buffer);
  } catch (e) {
    console.log("UTF-16LE failed, trying UTF-8 as final fallback");
    return new TextDecoder("utf-8").decode(buffer);
  }
}

// ------------------------- CSV Parsing -------------------------
function isNumericRow(tokens: string[]): boolean {
  if (tokens.length < 2) return false;
  
  // Check if first token is a number (row index)
  const firstToken = tokens[0].trim();
  if (!/^\d+$/.test(firstToken)) return false;
  
  // Check if at least some of the remaining tokens are numbers
  let numericCount = 0;
  for (let i = 1; i < Math.min(tokens.length, 10); i++) { // Check first 10 values
    const token = tokens[i].trim();
    if (token === '' || token === 'NaN') continue;
    const num = parseFloat(token);
    if (!isNaN(num) && isFinite(num)) {
      numericCount++;
    }
  }
  
  return numericCount >= 3; // At least 3 valid numeric values
}

function safeFloat(value: string): number {
  const cleaned = value.trim();
  if (cleaned === '' || cleaned === 'NaN') return NaN;
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? NaN : parsed;
}

function median(arr: number[]): number {
  if (arr.length === 0) return NaN;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 
    ? (sorted[mid - 1] + sorted[mid]) / 2 
    : sorted[mid];
}

function parseThermalCSV(text: string): { data: number[][], rows: number, cols: number, error?: string } {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  
  console.log(`Processing ${lines.length} lines from CSV file`);

  // Find first numeric row (following Python logic)
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const tokens = lines[i].split(",").map(t => t.trim());
    if (isNumericRow(tokens)) {
      startIdx = i;
      break;
    }
  }

  if (startIdx === -1) {
    return { 
      data: [], 
      rows: 0, 
      cols: 0, 
      error: "No numeric data rows found in the CSV." 
    };
  }

  console.log(`Found first numeric row at line ${startIdx + 1}`);

  // Parse all numeric rows
  const rows: number[][] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const tokens = lines[i].split(",").map(t => t.trim());
    if (!isNumericRow(tokens)) continue;
    
    // Drop index (first column) and parse values
    const values = tokens.slice(1).map(safeFloat);
    rows.push(values);
  }

  const numRowsObserved = rows.length;
  console.log(`Parsed ${numRowsObserved} numeric rows`);

  if (numRowsObserved === 0) {
    return { 
      data: [], 
      rows: 0, 
      cols: 0, 
      error: "No numeric rows parsed." 
    };
  }

  // Calculate median columns (following Python logic)
  const rowLengths = rows.map(r => r.length);
  const medianCols = Math.round(median(rowLengths));
  console.log(`Median columns: ${medianCols}`);

  // Determine target shape (following Python logic)
  const standardShapes = [[480, 640], [240, 320]];
  let bestShape: [number, number] | null = null;
  let bestScore: number | null = null;

  for (const [tr, tc] of standardShapes) {
    const score = Math.abs(numRowsObserved - tr) + Math.abs(medianCols - tc);
    if (bestShape === null || bestScore === null || score < bestScore) {
      bestShape = [tr, tc];
      bestScore = score;
    }
  }

  const [targetRows, targetCols] = bestShape || [480, 640];
  console.log(`Target shape: ${targetRows} × ${targetCols}`);

  // Calculate global median
  const allVals = rows.flat().filter(v => !isNaN(v));
  const globalMedian = allVals.length > 0 ? median(allVals) : 0.0;
  console.log(`Global median: ${globalMedian}`);

  // Process rows to target shape
  const processedRows: number[][] = [];
  
  for (let i = 0; i < targetRows; i++) {
    let row: number[];
    
    if (i < rows.length) {
      const originalRow = rows[i];
      
      if (originalRow.length > targetCols) {
        // Truncate if too long
        row = originalRow.slice(0, targetCols);
      } else {
        // Pad with NaN if too short
        row = [...originalRow];
        while (row.length < targetCols) {
          row.push(NaN);
        }
      }
      
      // Fill NaN values with row median, then global median
      const rowVals = row.filter(v => !isNaN(v));
      const rowMedian = rowVals.length > 0 ? median(rowVals) : globalMedian;
      
      row = row.map(v => isNaN(v) ? rowMedian : v);
    } else {
      // Fill missing rows with global median
      row = new Array(targetCols).fill(globalMedian);
    }
    
    processedRows.push(row);
  }

  // Final cleanup: fill any remaining NaNs
  for (let i = 0; i < processedRows.length; i++) {
    const row = processedRows[i];
    const mask = row.map(v => isNaN(v));
    const hasNaN = mask.some(Boolean);
    
    if (hasNaN) {
      const vals = row.filter(v => !isNaN(v));
      const med = vals.length > 0 ? median(vals) : globalMedian;
      row.forEach((v, j) => {
        if (isNaN(v)) row[j] = med;
      });
    }
  }

  console.log(`Final processed data: ${processedRows.length} rows × ${processedRows[0]?.length || 0} columns`);

  return { 
    data: processedRows, 
    rows: processedRows.length, 
    cols: processedRows[0]?.length || 0 
  };
}

// ------------------------- Utilities -------------------------
function flatten2D(arr: number[][]): number[] { return arr.flat(); }
function percentile(arr: number[], p: number): number {
  if (!arr.length) return NaN;
  const a = [...arr].sort((x, y) => x - y);
  const idx = (p / 100) * (a.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return a[lo];
  const t = idx - lo; return a[lo] * (1 - t) + a[hi] * t;
}

// ------------------------- Viewer -------------------------
export default function ThermalViewer() {
  const [grid, setGrid] = useState<number[][]>([]);
  const [rows, setRows] = useState(0);
  const [cols, setCols] = useState(0);
  const [palette, setPalette] = useState<keyof typeof palettes>("Jet");
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [hoverInfo, setHoverInfo] = useState<{x: number, y: number, temperature: number} | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [polygonPoints, setPolygonPoints] = useState<{x: number, y: number}[]>([]);
  const [deltaT, setDeltaT] = useState<{min: number, max: number, delta: number} | null>(null);
  const [temperatureRange, setTemperatureRange] = useState<{min: number, max: number} | null>(null);
  const [measurementMode, setMeasurementMode] = useState<'polygon' | 'single-box' | 'dual-box'>('polygon');
  const [box1, setBox1] = useState<{x1: number, y1: number, x2: number, y2: number} | null>(null);
  const [box2, setBox2] = useState<{x1: number, y1: number, x2: number, y2: number} | null>(null);
  const [isDrawingBox, setIsDrawingBox] = useState(false);
  const [currentBox, setCurrentBox] = useState<1 | 2>(1);
  const [tempBox, setTempBox] = useState<{x1: number, y1: number, x2: number, y2: number} | null>(null);
  const [mousePos, setMousePos] = useState<{x: number, y: number} | null>(null);
  const [tempMarkers, setTempMarkers] = useState<{x: number, y: number, temp: number, type: 'min' | 'max'}[]>([]);
  const [drawingColor, setDrawingColor] = useState('#ffffff');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  function handleFile(file: File) {
    setError("");
    setIsLoading(true);
    
    console.log(`Processing file: ${file.name} (${file.size} bytes)`);
    
    // Validate file type
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError("Please select a CSV file.");
      setIsLoading(false);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const buf = reader.result as ArrayBuffer;
        console.log(`File loaded: ${buf.byteLength} bytes`);
        
        const text = decodeBestEffort(buf);
        console.log(`Decoded text length: ${text.length} characters`);
        console.log(`First 200 characters:`, text.substring(0, 200));
        
        const parsed = parseThermalCSV(text);
        
        if (parsed.error) {
          console.error("Parsing error:", parsed.error);
          setError(parsed.error);
          setGrid([]);
          setRows(0);
          setCols(0);
        } else {
          console.log(`Successfully parsed: ${parsed.rows} rows × ${parsed.cols} columns`);
          setGrid(parsed.data);
          setRows(parsed.rows);
          setCols(parsed.cols);
          setError("");
        }
      } catch (err) {
        console.error("Processing error:", err);
        setError(`Error processing file: ${err instanceof Error ? err.message : 'Unknown error'}`);
        setGrid([]);
        setRows(0);
        setCols(0);
      } finally {
        setIsLoading(false);
      }
    };
    
    reader.onerror = () => {
      console.error("FileReader error");
      setError("Failed to read file. Please try again.");
      setIsLoading(false);
    };
    
    reader.readAsArrayBuffer(file);
  }

  // Combined effect to draw thermal image and polygon
  useEffect(() => {
    if (!grid.length || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas dimensions to match display size
    const W = 500;
    const H = 375;
    canvas.width = W;
    canvas.height = H;

    // Draw thermal image
    const flat = flatten2D(grid);
    const vmin = percentile(flat, 2);
    const vmax = percentile(flat, 98);
    const span = Math.max(1e-9, vmax - vmin);
    
    // Store temperature range for legend
    setTemperatureRange({min: vmin, max: vmax});

    const img = ctx.createImageData(W, H);
    const map = palettes[palette];
    let k = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // Scale coordinates to grid dimensions
        const gy = Math.floor((y / H) * rows);
        const gx = Math.floor((x / W) * cols);
        const v = clamp01(((grid[gy]?.[gx] ?? 0) - vmin) / span);
        const [r, g, b] = map(v);
        img.data[k++] = r;
        img.data[k++] = g;
        img.data[k++] = b;
        img.data[k++] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Draw polygon on top of thermal image
    if (polygonPoints.length > 0) {
      ctx.strokeStyle = drawingColor;
      ctx.lineWidth = 3;
      ctx.beginPath();
      
      polygonPoints.forEach((point, index) => {
        const canvasX = (point.x / cols) * W;
        const canvasY = (point.y / rows) * H;
        if (index === 0) {
          ctx.moveTo(canvasX, canvasY);
        } else {
          ctx.lineTo(canvasX, canvasY);
        }
      });
      
      // Close the polygon if we have 3 or more points and we're not currently drawing
      if (polygonPoints.length >= 3 && !isDrawing) {
        ctx.closePath();
      }
      ctx.stroke();
      
      // Draw points
      ctx.fillStyle = drawingColor;
      polygonPoints.forEach(point => {
        const canvasX = (point.x / cols) * W;
        const canvasY = (point.y / rows) * H;
        ctx.beginPath();
        ctx.arc(canvasX, canvasY, 4, 0, 2 * Math.PI);
        ctx.fill();
      });
    }

    // Draw professional boxes
    const drawBox = (box: {x1: number, y1: number, x2: number, y2: number}, color: string, label: string) => {
      const {x1, y1, x2, y2} = box;
      const canvasX1 = (x1 / cols) * W;
      const canvasY1 = (y1 / rows) * H;
      const canvasX2 = (x2 / cols) * W;
      const canvasY2 = (y2 / rows) * H;
      
      const minX = Math.min(canvasX1, canvasX2);
      const maxX = Math.max(canvasX1, canvasX2);
      const minY = Math.min(canvasY1, canvasY2);
      const maxY = Math.max(canvasY1, canvasY2);
      const width = maxX - minX;
      const height = maxY - minY;
      
      // Draw box with professional styling
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.setLineDash([]);
      ctx.strokeRect(minX, minY, width, height);
      
      // Draw corner markers
      const cornerSize = 8;
      ctx.fillStyle = color;
      ctx.fillRect(minX - cornerSize/2, minY - cornerSize/2, cornerSize, cornerSize);
      ctx.fillRect(maxX - cornerSize/2, minY - cornerSize/2, cornerSize, cornerSize);
      ctx.fillRect(minX - cornerSize/2, maxY - cornerSize/2, cornerSize, cornerSize);
      ctx.fillRect(maxX - cornerSize/2, maxY - cornerSize/2, cornerSize, cornerSize);
      
      // Draw label
      ctx.fillStyle = color;
      ctx.font = 'bold 12px Arial';
      ctx.fillText(label, minX + 5, minY - 5);
    };

    // Draw completed boxes
    if (box1) {
      drawBox(box1, drawingColor, 'Box 1');
    }
    
    if (box2) {
      drawBox(box2, drawingColor, 'Box 2');
    }

    // Draw temporary box preview
    if (tempBox) {
      const {x1, y1, x2, y2} = tempBox;
      const canvasX1 = (x1 / cols) * W;
      const canvasY1 = (y1 / rows) * H;
      const canvasX2 = (x2 / cols) * W;
      const canvasY2 = (y2 / rows) * H;
      
      const minX = Math.min(canvasX1, canvasX2);
      const maxX = Math.max(canvasX1, canvasX2);
      const minY = Math.min(canvasY1, canvasY2);
      const maxY = Math.max(canvasY1, canvasY2);
      const width = maxX - minX;
      const height = maxY - minY;
      
      // Draw preview box with dashed line
      ctx.strokeStyle = drawingColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(minX, minY, width, height);
      ctx.setLineDash([]);
      
      // Draw crosshair at current position
      if (mousePos) {
        const crossX = (mousePos.x / cols) * W;
        const crossY = (mousePos.y / rows) * H;
        
        ctx.strokeStyle = drawingColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(crossX - 10, crossY);
        ctx.lineTo(crossX + 10, crossY);
        ctx.moveTo(crossX, crossY - 10);
        ctx.lineTo(crossX, crossY + 10);
        ctx.stroke();
      }
    }

    // Draw temperature markers
    tempMarkers.forEach(marker => {
      const canvasX = (marker.x / cols) * W;
      const canvasY = (marker.y / rows) * H;
      
      // Professional T-shape marker with color coding
      const markerSize = 8;
      const lineWidth = 3;
      const markerColor = marker.type === 'max' ? '#dc2626' : '#2563eb'; // Red for max, blue for min
      
      ctx.save();
      ctx.strokeStyle = markerColor;
      ctx.fillStyle = '#ffffff';
      ctx.lineWidth = lineWidth;
      
      // Draw T-shape marker
      // Vertical line
      ctx.beginPath();
      ctx.moveTo(canvasX, canvasY - markerSize);
      ctx.lineTo(canvasX, canvasY + markerSize);
      ctx.stroke();
      
      // Horizontal line
      ctx.beginPath();
      ctx.moveTo(canvasX - markerSize, canvasY);
      ctx.lineTo(canvasX + markerSize, canvasY);
      ctx.stroke();
      
      // Draw center dot
      ctx.beginPath();
      ctx.arc(canvasX, canvasY, 2, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      
      // Draw temperature value only
      const tempText = `${marker.temp.toFixed(1)}°C`;
      
      // Calculate text dimensions
      ctx.font = 'bold 8px Arial';
      const tempMetrics = ctx.measureText(tempText);
      const textWidth = tempMetrics.width;
      const textHeight = 10;
      
      // Draw semi-transparent white background rectangle
      const rectX = canvasX - (textWidth / 2) - 3;
      const rectY = canvasY + markerSize + 4;
      const rectWidth = textWidth + 6;
      
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.fillRect(rectX, rectY, rectWidth, textHeight + 2);
      
      // Draw temperature text in black
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 8px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(tempText, canvasX, rectY + 1);
      
      ctx.restore();
    });
  }, [grid, palette, rows, cols, polygonPoints, isDrawing, box1, box2, tempBox, currentBox, mousePos, tempMarkers, drawingColor]);

  // Auto-calculate delta T when boxes are completed
  useEffect(() => {
    if (measurementMode === 'single-box' && box1 && !isDrawingBox) {
      calculateBoxDeltaT();
    }
  }, [box1, measurementMode, isDrawingBox]);

  useEffect(() => {
    if (measurementMode === 'dual-box' && box1 && box2 && !isDrawingBox) {
      calculateDualBoxDeltaT();
    }
  }, [box1, box2, measurementMode, isDrawingBox]);

  // Handle mouse hover to show temperature
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!grid.length || !canvasRef.current || rows === 0 || cols === 0) {
      setHoverInfo(null);
      return;
    }

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const x = Math.floor((e.clientX - rect.left) * scaleX);
    const y = Math.floor((e.clientY - rect.top) * scaleY);
    
    // Convert canvas coordinates to grid coordinates
    const gridX = Math.floor((x / canvas.width) * cols);
    const gridY = Math.floor((y / canvas.height) * rows);
    
    if (gridY >= 0 && gridY < rows && gridX >= 0 && gridX < cols) {
      const temperature = grid[gridY][gridX];
      setHoverInfo({
        x: gridX,
        y: gridY,
        temperature: temperature
      });
      
      // Update mouse position for box drawing
      setMousePos({x: gridX, y: gridY});
      
      // Update temporary box for real-time preview
      if (isDrawingBox && tempBox) {
        setTempBox(prev => prev ? {...prev, x2: gridX, y2: gridY} : null);
      }
    } else {
      setHoverInfo(null);
    }

    // Redraw canvas with preview line when drawing
    if (isDrawing && polygonPoints.length > 0) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        // Define canvas dimensions
        const W = 500;
        const H = 375;
        
        // Redraw the thermal image first using the same method as main draw
        if (grid.length > 0) {
          const img = ctx.createImageData(W, H);
          
          // Use the same thermal rendering logic as the main draw function
          const flat = flatten2D(grid);
          const vmin = percentile(flat, 2);
          const vmax = percentile(flat, 98);
          const span = Math.max(1e-9, vmax - vmin);
          const map = palettes[palette];
          
          let k = 0;
          for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
              const gy = Math.floor((y / H) * rows);
              const gx = Math.floor((x / W) * cols);
              const v = clamp01(((grid[gy]?.[gx] ?? 0) - vmin) / span);
              const [r, g, b] = map(v);
              img.data[k++] = r;
              img.data[k++] = g;
              img.data[k++] = b;
              img.data[k++] = 255;
            }
          }
          ctx.putImageData(img, 0, 0);
        }

        // Draw existing polygon
        if (polygonPoints.length > 0) {
          ctx.strokeStyle = drawingColor;
          ctx.lineWidth = 3;
          ctx.beginPath();
          
          polygonPoints.forEach((point, index) => {
            const canvasX = (point.x / cols) * W;
            const canvasY = (point.y / rows) * H;
            if (index === 0) {
              ctx.moveTo(canvasX, canvasY);
            } else {
              ctx.lineTo(canvasX, canvasY);
            }
          });
          ctx.stroke();
          
          // Draw existing points
          ctx.fillStyle = drawingColor;
          polygonPoints.forEach(point => {
            const canvasX = (point.x / cols) * W;
            const canvasY = (point.y / rows) * H;
            ctx.beginPath();
            ctx.arc(canvasX, canvasY, 4, 0, 2 * Math.PI);
            ctx.fill();
          });
        }
        
        // Draw preview line to current mouse position
        const lastPoint = polygonPoints[polygonPoints.length - 1];
        const lastCanvasX = (lastPoint.x / cols) * W;
        const lastCanvasY = (lastPoint.y / rows) * H;
        const currentCanvasX = (gridX / cols) * W;
        const currentCanvasY = (gridY / rows) * H;
        
        ctx.strokeStyle = drawingColor;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(lastCanvasX, lastCanvasY);
        ctx.lineTo(currentCanvasX, currentCanvasY);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  };

  const handleMouseLeave = () => {
    setHoverInfo(null);
  };

  // Point-in-polygon test using ray casting algorithm
  const pointInPolygon = (point: {x: number, y: number}, polygon: {x: number, y: number}[]) => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      if (((polygon[i].y > point.y) !== (polygon[j].y > point.y)) &&
          (point.x < (polygon[j].x - polygon[i].x) * (point.y - polygon[i].y) / (polygon[j].y - polygon[i].y) + polygon[i].x)) {
        inside = !inside;
      }
    }
    return inside;
  };

  // Calculate delta T for polygon area
  const calculateDeltaT = () => {
    if (polygonPoints.length < 3 || !grid.length) return;

    const temperatures: number[] = [];
    const pointsInPolygon: {x: number, y: number, temp: number}[] = [];
    
    // Check each pixel in the grid
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (pointInPolygon({x, y}, polygonPoints)) {
          const temp = grid[y][x];
          temperatures.push(temp);
          pointsInPolygon.push({x, y, temp});
        }
      }
    }

    if (temperatures.length > 0) {
      const min = Math.min(...temperatures);
      const max = Math.max(...temperatures);
      const delta = max - min;
      setDeltaT({min, max, delta});
      
      // Find and mark the min/max temperature locations
      const minPoint = pointsInPolygon.find(p => p.temp === min);
      const maxPoint = pointsInPolygon.find(p => p.temp === max);
      
      const markers: {x: number, y: number, temp: number, type: 'min' | 'max'}[] = [];
      if (minPoint) markers.push({...minPoint, type: 'min'});
      if (maxPoint) markers.push({...maxPoint, type: 'max'});
      setTempMarkers(markers);
    }
  };

  // Calculate delta T for single box
  const calculateBoxDeltaT = () => {
    if (!box1 || !grid.length) return;
    
    const temperatures: number[] = [];
    const pointsInBox: {x: number, y: number, temp: number}[] = [];
    const {x1, y1, x2, y2} = box1;
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (y >= 0 && y < rows && x >= 0 && x < cols) {
          const temp = grid[y][x];
          temperatures.push(temp);
          pointsInBox.push({x, y, temp});
        }
      }
    }
    
    if (temperatures.length > 0) {
      const min = Math.min(...temperatures);
      const max = Math.max(...temperatures);
      const delta = max - min;
      setDeltaT({min, max, delta});
      
      // Find and mark the min/max temperature locations
      const minPoint = pointsInBox.find(p => p.temp === min);
      const maxPoint = pointsInBox.find(p => p.temp === max);
      
      const markers: {x: number, y: number, temp: number, type: 'min' | 'max'}[] = [];
      if (minPoint) markers.push({...minPoint, type: 'min'});
      if (maxPoint) markers.push({...maxPoint, type: 'max'});
      setTempMarkers(markers);
      
      console.log(`Single box delta T: min=${min.toFixed(2)}, max=${max.toFixed(2)}, delta=${delta.toFixed(2)}`);
    }
  };

  // Calculate delta T for dual boxes
  const calculateDualBoxDeltaT = () => {
    if (!box1 || !box2 || !grid.length) return;
    
    const getBoxMaxTempAndLocation = (box: {x1: number, y1: number, x2: number, y2: number}) => {
      const temperatures: number[] = [];
      const pointsInBox: {x: number, y: number, temp: number}[] = [];
      const {x1, y1, x2, y2} = box;
      const minX = Math.min(x1, x2);
      const maxX = Math.max(x1, x2);
      const minY = Math.min(y1, y2);
      const maxY = Math.max(y1, y2);
      
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          if (y >= 0 && y < rows && x >= 0 && x < cols) {
            const temp = grid[y][x];
            temperatures.push(temp);
            pointsInBox.push({x, y, temp});
          }
        }
      }
      
      if (temperatures.length > 0) {
        const max = Math.max(...temperatures);
        const maxPoint = pointsInBox.find(p => p.temp === max);
        return {max, maxPoint};
      }
      return {max: 0, maxPoint: null};
    };
    
    const result1 = getBoxMaxTempAndLocation(box1);
    const result2 = getBoxMaxTempAndLocation(box2);
    const max1 = result1.max;
    const max2 = result2.max;
    const delta = Math.abs(max1 - max2);
    
    setDeltaT({
      min: Math.min(max1, max2),
      max: Math.max(max1, max2),
      delta
    });
    
    // Mark the max temperature locations from each box
    const markers: {x: number, y: number, temp: number, type: 'min' | 'max'}[] = [];
    if (result1.maxPoint) markers.push({...result1.maxPoint, type: max1 > max2 ? 'max' : 'min'});
    if (result2.maxPoint) markers.push({...result2.maxPoint, type: max2 > max1 ? 'max' : 'min'});
    setTempMarkers(markers);
    
    console.log(`Dual box delta T: Box1 max=${max1.toFixed(2)}, Box2 max=${max2.toFixed(2)}, delta=${delta.toFixed(2)}`);
  };

  // Handle canvas interactions for different measurement modes
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || rows === 0 || cols === 0) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const x = Math.floor((e.clientX - rect.left) * scaleX);
    const y = Math.floor((e.clientY - rect.top) * scaleY);
    
    // Convert canvas coordinates to grid coordinates
    const gridX = Math.floor((x / canvas.width) * cols);
    const gridY = Math.floor((y / canvas.height) * rows);
    
    if (gridY < 0 || gridY >= rows || gridX < 0 || gridX >= cols) return;

    if (measurementMode === 'polygon') {
      if (!isDrawing) return;

      // Handle right-click to complete polygon
      if (e.button === 2) {
        e.preventDefault();
        if (polygonPoints.length >= 3) {
          setIsDrawing(false);
          calculateDeltaT();
        }
        return;
      }

      // Handle left-click to add point
      if (e.button === 0) {
        setPolygonPoints(prev => [...prev, {x: gridX, y: gridY}]);
      }
    } else if (measurementMode === 'single-box' || measurementMode === 'dual-box') {
      if (!isDrawingBox) return;

      if (e.button === 0) {
        if (measurementMode === 'single-box') {
          if (!tempBox) {
            // Start drawing first box
            setTempBox({x1: gridX, y1: gridY, x2: gridX, y2: gridY});
          } else {
            // Complete first box
            setBox1(tempBox);
            setTempBox(null);
            setIsDrawingBox(false);
          }
        } else if (measurementMode === 'dual-box') {
          if (currentBox === 1) {
            if (!tempBox) {
              // Start drawing first box
              setTempBox({x1: gridX, y1: gridY, x2: gridX, y2: gridY});
            } else {
              // Complete first box, start second
              setBox1(tempBox);
              setTempBox(null);
              setCurrentBox(2);
            }
          } else {
            if (!tempBox) {
              // Start drawing second box
              setTempBox({x1: gridX, y1: gridY, x2: gridX, y2: gridY});
            } else {
              // Complete second box
              setBox2(tempBox);
              setTempBox(null);
              setIsDrawingBox(false);
            }
          }
        }
      }
    }
  };

  // Start/stop polygon drawing
  const toggleDrawing = () => {
    if (isDrawing) {
      setIsDrawing(false);
      if (polygonPoints.length >= 3) {
        calculateDeltaT();
      }
    } else {
      setIsDrawing(true);
      setPolygonPoints([]);
      setDeltaT(null);
      
      // Trigger a redraw to ensure thermal image is visible when starting to draw
      if (canvasRef.current && grid.length > 0) {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          // Redraw thermal image
          const W = cols;
          const H = rows;
          const img = ctx.createImageData(W, H);
          
          const flat = flatten2D(grid);
          const vmin = percentile(flat, 2);
          const vmax = percentile(flat, 98);
          const span = Math.max(1e-9, vmax - vmin);
          const map = palettes[palette];
          
          let k = 0;
          for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
              const v = clamp01((grid[y][x] - vmin) / span);
              const [r, g, b] = map(v);
              img.data[k++] = r;
              img.data[k++] = g;
              img.data[k++] = b;
              img.data[k++] = 255;
            }
          }
          ctx.putImageData(img, 0, 0);
        }
      }
    }
  };

  // Clear polygon
  const clearPolygon = () => {
    setPolygonPoints([]);
    setDeltaT(null);
    setIsDrawing(false);
  };

  // Render the full component content when mounted
  const renderContent = () => {
    return (
      <>
        {/* Controls Header */}
        <div className="bg-gray-50 px-6 py-4 border-b border-border">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Upload className="w-4 h-4 text-muted-foreground" />
            <input 
              type="file" 
              accept=".csv" 
              onChange={(e)=>{
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }} 
              disabled={isLoading}
              className="text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 disabled:opacity-50"
            />
            </div>
            
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-muted-foreground" />
            <select 
              value={palette} 
              onChange={(e)=>setPalette(e.target.value as any)} 
              disabled={isLoading}
                className="border rounded-lg px-3 py-2 bg-background text-foreground border-border disabled:opacity-50 min-w-[140px]"
            >
              {Object.keys(palettes).map(k => <option key={k} value={k}>{k}</option>)}
            </select>
            </div>
            
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">Mode:</span>
          <select 
            value={measurementMode} 
            onChange={(e) => {
              const mode = e.target.value as 'polygon' | 'single-box' | 'dual-box';
              setMeasurementMode(mode);
              setIsDrawing(false);
              setIsDrawingBox(false);
              setPolygonPoints([]);
              setBox1(null);
              setBox2(null);
              setDeltaT(null);
              setTempMarkers([]);
              setTempBox(null);
              setMousePos(null);
            }}
            disabled={isLoading || !grid.length}
            className="border rounded-lg px-3 py-2 bg-background text-foreground border-border disabled:opacity-50 min-w-[120px]"
          >
                  <option value="polygon">Polygon</option>
                  <option value="single-box">Single Box</option>
                  <option value="dual-box">Dual Box</option>
                </select>
              </div>
              
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">Color:</span>
                <input
                  type="color"
                  value={drawingColor}
                  onChange={(e) => setDrawingColor(e.target.value)}
                  disabled={isLoading || !grid.length}
                  className="w-8 h-8 border border-border rounded cursor-pointer disabled:opacity-50"
                  title="Select drawing color"
                />
              </div>
              
              <Button 
                onClick={() => {
                  if (measurementMode === 'polygon') {
                    // Clear any existing boxes when starting polygon drawing
                    setBox1(null);
                    setBox2(null);
                    setTempBox(null);
                    setTempMarkers([]);
                    setDeltaT(null);
                    toggleDrawing();
                  } else {
                    // Clear any existing polygon when starting box drawing
                    setPolygonPoints([]);
                    setTempMarkers([]);
                    setDeltaT(null);
                    setIsDrawingBox(!isDrawingBox);
                    if (!isDrawingBox) {
                      setBox1(null);
                      setBox2(null);
                      setCurrentBox(1);
                    }
                  }
                }}
                variant={isDrawing || isDrawingBox ? "destructive" : "default"}
                disabled={isLoading || !grid.length}
                className="px-4 py-2"
              >
                {measurementMode === 'polygon' 
                  ? (isDrawing ? "Stop Drawing" : "Draw Polygon")
                  : (isDrawingBox ? "Stop Drawing" : "Draw Box")
                }
              </Button>
              <Button 
                onClick={() => {
                  setPolygonPoints([]);
                  setBox1(null);
                  setBox2(null);
                  setDeltaT(null);
                  setIsDrawing(false);
                  setIsDrawingBox(false);
                  setCurrentBox(1);
                  setTempBox(null);
                  setMousePos(null);
                  setTempMarkers([]);
                }}
                variant="outline"
                disabled={isLoading}
                className="px-4 py-2"
              >
                Clear
              </Button>
            </div>
            
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              {isLoading && <div className="flex items-center gap-2"><div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>Processing...</div>}
              {rows && cols && <div>Resolution: {cols}×{rows}</div>}
            </div>
          </div>
          
          {/* Status Messages */}
          <div className="mt-3 space-y-1">
            {isDrawing && measurementMode === 'polygon' && <div className="text-sm text-primary font-medium flex items-center gap-2"><div className="w-2 h-2 bg-primary rounded-full"></div>Left-click to add points, Right-click to complete polygon</div>}
            {isDrawingBox && measurementMode === 'single-box' && !tempBox && <div className="text-sm text-primary font-medium flex items-center gap-2"><div className="w-2 h-2 bg-primary rounded-full"></div>Click to start drawing measurement box</div>}
            {isDrawingBox && measurementMode === 'single-box' && tempBox && <div className="text-sm text-primary font-medium flex items-center gap-2"><div className="w-2 h-2 bg-primary rounded-full"></div>Click to complete measurement box</div>}
            {isDrawingBox && measurementMode === 'dual-box' && currentBox === 1 && !tempBox && <div className="text-sm text-primary font-medium flex items-center gap-2"><div className="w-2 h-2 bg-primary rounded-full"></div>Click to start drawing Box 1</div>}
            {isDrawingBox && measurementMode === 'dual-box' && currentBox === 1 && tempBox && <div className="text-sm text-primary font-medium flex items-center gap-2"><div className="w-2 h-2 bg-primary rounded-full"></div>Click to complete Box 1</div>}
            {isDrawingBox && measurementMode === 'dual-box' && currentBox === 2 && !tempBox && <div className="text-sm text-primary font-medium flex items-center gap-2"><div className="w-2 h-2 bg-primary rounded-full"></div>Click to start drawing Box 2</div>}
            {isDrawingBox && measurementMode === 'dual-box' && currentBox === 2 && tempBox && <div className="text-sm text-primary font-medium flex items-center gap-2"><div className="w-2 h-2 bg-primary rounded-full"></div>Click to complete Box 2</div>}
            {!isDrawing && !isDrawingBox && polygonPoints.length >= 3 && measurementMode === 'polygon' && <div className="text-sm text-green-600 font-medium flex items-center gap-2"><div className="w-2 h-2 bg-green-600 rounded-full"></div>✓ Polygon completed - Delta T calculated</div>}
            {!isDrawingBox && box1 && measurementMode === 'single-box' && <div className="text-sm text-green-600 font-medium flex items-center gap-2"><div className="w-2 h-2 bg-green-600 rounded-full"></div>✓ Single box completed - Delta T calculated</div>}
            {!isDrawingBox && box1 && box2 && measurementMode === 'dual-box' && <div className="text-sm text-green-600 font-medium flex items-center gap-2"><div className="w-2 h-2 bg-green-600 rounded-full"></div>✓ Dual boxes completed - Delta T calculated</div>}
          </div>
        </div>
        
        {/* Main Content */}
        <div className="p-6">
          
          {error && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
              <div className="text-destructive font-medium">Error</div>
              <div className="text-destructive/80 text-sm mt-1">{error}</div>
            </div>
          )}

          {deltaT && (
            <div className="bg-primary/10 border border-primary/20 rounded-lg p-4">
              <div className="text-primary font-medium mb-2">Delta T Analysis</div>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground">Min Temperature</div>
                  <div className="font-mono text-lg">{deltaT.min.toFixed(2)}°C</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Max Temperature</div>
                  <div className="font-mono text-lg">{deltaT.max.toFixed(2)}°C</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Delta T</div>
                  <div className="font-mono text-lg font-bold text-primary">{deltaT.delta.toFixed(2)}°C</div>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-6 items-start">
            <div className="flex flex-col">
              <div className="relative inline-block">
                <canvas 
                  ref={canvasRef} 
                  style={{
                    imageRendering: "pixelated", 
                    width: "500px",
                    height: "375px"
                  }} 
                  className={`border rounded border-border ${isDrawing ? 'cursor-crosshair' : 'cursor-crosshair'}`}
                  onMouseMove={handleMouseMove}
                  onMouseLeave={handleMouseLeave}
                  onMouseDown={handleCanvasClick}
                  onContextMenu={(e) => e.preventDefault()}
                />
                {hoverInfo && (
                  <>
                    {/* Professional crosshair indicator */}
                    <div className="absolute pointer-events-none z-20">
                      <div 
                        className="absolute w-4 h-0.5 bg-white/80"
                        style={{
                          left: `${(hoverInfo.x / cols) * 500 - 8}px`,
                          top: `${(hoverInfo.y / rows) * 375}px`
                        }}
                      />
                      <div 
                        className="absolute w-0.5 h-4 bg-white/80"
                        style={{
                          left: `${(hoverInfo.x / cols) * 500}px`,
                          top: `${(hoverInfo.y / rows) * 375 - 8}px`
                        }}
                      />
                      <div 
                        className="absolute w-2 h-2 border-2 border-white rounded-full"
                        style={{
                          left: `${(hoverInfo.x / cols) * 500 - 4}px`,
                          top: `${(hoverInfo.y / rows) * 375 - 4}px`
                        }}
                      />
                    </div>
                  </>
                )}
              </div>
              
              {/* Fixed Measurement Panel at Bottom */}
              <div className="mt-3 bg-white border border-border rounded-lg p-3 shadow-sm w-full">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 bg-primary rounded-full"></div>
                    <span className="text-xs font-semibold text-foreground">Live Measurement</span>
                  </div>
                  <div className="text-xs text-muted-foreground">Hover to measure</div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-50 rounded-md p-2 border border-gray-200">
                    <div className="flex items-center gap-1 mb-1">
                      <div className="w-1 h-1 bg-blue-500 rounded-full"></div>
                      <span className="text-xs font-medium text-blue-700">Position</span>
                    </div>
                  <div className="text-sm font-bold text-gray-900 font-mono">
                    {hoverInfo ? `(${hoverInfo.x}, ${hoverInfo.y})` : '(0, 0)'}
                  </div>
                </div>
                <div className="bg-gray-50 rounded-md p-2 border border-gray-200">
                  <div className="flex items-center gap-1 mb-1">
                    <div className="w-1 h-1 bg-red-500 rounded-full"></div>
                    <span className="text-xs font-medium text-red-700">Temperature</span>
                  </div>
                  <div className="text-sm font-bold text-gray-900 font-mono">
                    {hoverInfo ? `${hoverInfo.temperature.toFixed(2)}°C` : '0.00°C'}
                  </div>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Temperature Legend */}
          {temperatureRange && (
            <div className="bg-white border border-border rounded-lg p-3 shadow-sm">
              <div className="text-xs font-medium text-foreground mb-2">Temperature Scale</div>
              <div className="flex items-start gap-2">
                {/* Temperature values aligned with gradient */}
                <div className="flex flex-col justify-between h-72 text-xs text-muted-foreground font-mono">
                  {[1, 0.75, 0.5, 0.25, 0].map((ratio, index) => {
                    const temp = temperatureRange.min + (temperatureRange.max - temperatureRange.min) * ratio;
                    return (
                      <div key={index} className="text-right">
                        {temp.toFixed(1)}°C
                      </div>
                    );
                  })}
                </div>
                
                {/* Gradient bar */}
                <div 
                  className="w-6 h-72 rounded border border-border relative"
                  style={{
                    background: `linear-gradient(to bottom, 
                      rgb(${palettes[palette](1).join(',')}), 
                      rgb(${palettes[palette](0.8).join(',')}), 
                      rgb(${palettes[palette](0.6).join(',')}), 
                      rgb(${palettes[palette](0.4).join(',')}), 
                      rgb(${palettes[palette](0.2).join(',')}), 
                      rgb(${palettes[palette](0).join(',')}))`
                  }}
                >
                  {/* Scale markers */}
                  {[0, 0.25, 0.5, 0.75, 1].map((ratio, index) => {
                    return (
                      <div
                        key={index}
                        className="absolute w-1 h-0.5 bg-white border border-gray-400"
                        style={{
                          left: '-2px',
                          top: `${ratio * 100}%`,
                          transform: 'translateY(-50%)'
                        }}
                      />
                    );
                  })}
                </div>
              </div>
              
              <div className="text-xs text-muted-foreground mt-2 text-center">
                {palette}
              </div>
            </div>
          )}
          </div>
        </div>
      </>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-violet-50 to-indigo-50">
      <div className="container mx-auto p-6">
        <div className="mb-6">
          <Link href="/">
            <Button variant="outline" className="mb-4">
              ← Back to Home
            </Button>
          </Link>
          <div className="bg-gradient-to-r from-purple-600 to-violet-600 rounded-xl p-6 text-white">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
                <Thermometer className="w-5 h-5" />
              </div>
              <h1 className="text-3xl font-bold">Thermal Analysis Viewer</h1>
            </div>
            <p className="text-purple-100">Professional thermal imaging and measurement tools</p>
          </div>
        </div>
        
        <div className="bg-white rounded-xl shadow-lg border border-border overflow-hidden">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}

