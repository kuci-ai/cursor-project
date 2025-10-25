"use client";
import React, { useMemo, useRef, useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

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

  useEffect(() => {
    if (!grid.length || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    const W = cols, H = rows;
    canvasRef.current.width = W;
    canvasRef.current.height = H;

    const flat = flatten2D(grid);
    const vmin = percentile(flat, 2);
    const vmax = percentile(flat, 98);
    const span = Math.max(1e-9, vmax - vmin);

    const img = ctx.createImageData(W, H);
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
  }, [grid, palette, rows, cols]);

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
    } else {
      setHoverInfo(null);
    }
  };

  const handleMouseLeave = () => {
    setHoverInfo(null);
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
          <h1 className="text-3xl font-bold text-foreground mb-2">Thermal CSV Viewer</h1>
          <p className="text-muted-foreground">Upload FLIR/FLUKE CSV files to view thermal images</p>
        </div>
        
        <div className="border rounded-lg p-6 border-border">
          <div className="flex flex-col gap-4">
            <div className="flex gap-4 items-center flex-wrap">
              <input 
                type="file" 
                accept=".csv" 
                onChange={(e)=>{
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }} 
                disabled={isLoading}
                className="file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/80 disabled:opacity-50"
              />
              <select 
                value={palette} 
                onChange={(e)=>setPalette(e.target.value as any)} 
                disabled={isLoading}
                className="border rounded px-2 py-1 bg-background text-foreground border-border disabled:opacity-50"
              >
                {Object.keys(palettes).map(k => <option key={k} value={k}>{k}</option>)}
              </select>
              {isLoading && <div className="text-sm text-muted-foreground">Processing...</div>}
              {rows && cols ? <div className="text-sm text-muted-foreground">Detected: {cols}×{rows}</div> : null}
            </div>
            
            {error && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
                <div className="text-destructive font-medium">Error</div>
                <div className="text-destructive/80 text-sm mt-1">{error}</div>
              </div>
            )}

            <div className="relative inline-block">
              <canvas 
                ref={canvasRef} 
                style={{
                  imageRendering: "pixelated", 
                  width: cols > 0 ? Math.min(960, cols * 1.5) : undefined, 
                  height: rows > 0 ? Math.min(720, rows * 1.5) : undefined
                }} 
                className="border rounded border-border cursor-crosshair" 
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
              />
              {hoverInfo && (
                <div className="absolute top-2 left-2 bg-black/80 text-white px-3 py-2 rounded-lg text-sm font-mono pointer-events-none z-10">
                  <div>Position: ({hoverInfo.x}, {hoverInfo.y})</div>
                  <div>Temperature: {hoverInfo.temperature.toFixed(2)}°C</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
