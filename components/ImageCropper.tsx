'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Card } from '@/components/ui/card';
import { ZoomIn, ZoomOut, Crop, RotateCcw, Download, Upload, LogOut, Save, Square, Pentagon } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';

interface Point {
  x: number;
  y: number;
}

interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

type CropMode = 'rectangle' | 'polygon';

export default function ImageCropper() {
  const [image, setImage] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [cropArea, setCropArea] = useState<CropArea | null>(null);
  const [polygonPoints, setPolygonPoints] = useState<Point[]>([]);
  const [cropMode, setCropMode] = useState<CropMode>('rectangle');
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imagePosition, setImagePosition] = useState({ x: 0, y: 0 });
  const [originalFilename, setOriginalFilename] = useState('');
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement>(null);
  const { user, signOut } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setOriginalFilename(file.name);
      const reader = new FileReader();
      reader.onload = (event) => {
        setImage(event.target?.result as string);
        setZoom(1);
        setImagePosition({ x: 0, y: 0 });
        setCropArea(null);
        setPolygonPoints([]);
      };
      reader.readAsDataURL(file);
    }
  };

  const drawImage = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img || !image) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    ctx.translate(centerX + imagePosition.x, centerY + imagePosition.y);
    ctx.scale(zoom, zoom);

    const drawWidth = img.naturalWidth;
    const drawHeight = img.naturalHeight;
    ctx.drawImage(img, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);

    ctx.restore();

    if (cropMode === 'rectangle' && cropArea) {
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(cropArea.x, cropArea.y, cropArea.width, cropArea.height);

      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(0, 0, canvas.width, cropArea.y);
      ctx.fillRect(0, cropArea.y, cropArea.x, cropArea.height);
      ctx.fillRect(cropArea.x + cropArea.width, cropArea.y, canvas.width - (cropArea.x + cropArea.width), cropArea.height);
      ctx.fillRect(0, cropArea.y + cropArea.height, canvas.width, canvas.height - (cropArea.y + cropArea.height));

      const handleSize = 10;
      ctx.fillStyle = '#f59e0b';
      ctx.setLineDash([]);
      ctx.fillRect(cropArea.x - handleSize / 2, cropArea.y - handleSize / 2, handleSize, handleSize);
      ctx.fillRect(cropArea.x + cropArea.width - handleSize / 2, cropArea.y - handleSize / 2, handleSize, handleSize);
      ctx.fillRect(cropArea.x - handleSize / 2, cropArea.y + cropArea.height - handleSize / 2, handleSize, handleSize);
      ctx.fillRect(cropArea.x + cropArea.width - handleSize / 2, cropArea.y + cropArea.height - handleSize / 2, handleSize, handleSize);
    }

    if (cropMode === 'polygon' && polygonPoints.length > 0) {
      ctx.beginPath();
      ctx.moveTo(polygonPoints[0].x, polygonPoints[0].y);
      for (let i = 1; i < polygonPoints.length; i++) {
        ctx.lineTo(polygonPoints[i].x, polygonPoints[i].y);
      }
      ctx.closePath();
      ctx.strokeStyle = '#ec4899';
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 5]);
      ctx.stroke();

      ctx.save();
      ctx.clip();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();

      ctx.setLineDash([]);
      polygonPoints.forEach((point, index) => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 6, 0, 2 * Math.PI);
        ctx.fillStyle = index === 0 ? '#10b981' : '#f59e0b';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      });
    }
  }, [image, zoom, imagePosition, cropArea, cropMode, polygonPoints]);

  useEffect(() => {
    drawImage();
  }, [drawImage]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (cropMode === 'polygon') {
      setPolygonPoints([...polygonPoints, { x, y }]);
    } else {
      if (cropArea) {
        const isInsideCrop =
          x >= cropArea.x &&
          x <= cropArea.x + cropArea.width &&
          y >= cropArea.y &&
          y <= cropArea.y + cropArea.height;

        if (!isInsideCrop) {
          setCropArea({ x, y, width: 0, height: 0 });
        }
      } else {
        setCropArea({ x, y, width: 0, height: 0 });
      }

      setIsDragging(true);
      setDragStart({ x, y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging || cropMode === 'polygon') return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (cropArea) {
      const width = x - cropArea.x;
      const height = y - cropArea.y;
      setCropArea({ ...cropArea, width, height });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleZoomChange = (value: number[]) => {
    setZoom(value[0]);
  };

  const getCroppedImageData = () => {
    if (cropMode === 'rectangle') {
      if (!cropArea || !imageRef.current || !canvasRef.current) return null;

      const cropCanvas = cropCanvasRef.current;
      if (!cropCanvas) return null;

      const canvas = canvasRef.current;
      const img = imageRef.current;

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      const imgX = centerX + imagePosition.x - (img.naturalWidth * zoom) / 2;
      const imgY = centerY + imagePosition.y - (img.naturalHeight * zoom) / 2;

      const cropX = (cropArea.x - imgX) / zoom;
      const cropY = (cropArea.y - imgY) / zoom;
      const cropWidth = Math.abs(cropArea.width / zoom);
      const cropHeight = Math.abs(cropArea.height / zoom);

      cropCanvas.width = cropWidth;
      cropCanvas.height = cropHeight;

      const ctx = cropCanvas.getContext('2d');
      if (!ctx) return null;

      ctx.drawImage(
        img,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
        0,
        0,
        cropWidth,
        cropHeight
      );

      return {
        dataUrl: cropCanvas.toDataURL('image/png'),
        width: cropWidth,
        height: cropHeight
      };
    } else if (cropMode === 'polygon') {
      if (polygonPoints.length < 3 || !imageRef.current || !canvasRef.current) return null;

      const cropCanvas = cropCanvasRef.current;
      if (!cropCanvas) return null;

      const canvas = canvasRef.current;
      const img = imageRef.current;

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      const imgX = centerX + imagePosition.x - (img.naturalWidth * zoom) / 2;
      const imgY = centerY + imagePosition.y - (img.naturalHeight * zoom) / 2;

      const minX = Math.min(...polygonPoints.map(p => p.x));
      const maxX = Math.max(...polygonPoints.map(p => p.x));
      const minY = Math.min(...polygonPoints.map(p => p.y));
      const maxY = Math.max(...polygonPoints.map(p => p.y));

      const width = maxX - minX;
      const height = maxY - minY;

      cropCanvas.width = width;
      cropCanvas.height = height;

      const ctx = cropCanvas.getContext('2d');
      if (!ctx) return null;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(polygonPoints[0].x - minX, polygonPoints[0].y - minY);
      for (let i = 1; i < polygonPoints.length; i++) {
        ctx.lineTo(polygonPoints[i].x - minX, polygonPoints[i].y - minY);
      }
      ctx.closePath();
      ctx.clip();

      const sourceX = (minX - imgX) / zoom;
      const sourceY = (minY - imgY) / zoom;
      const sourceWidth = width / zoom;
      const sourceHeight = height / zoom;

      ctx.drawImage(
        img,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        width,
        height
      );

      ctx.restore();

      return {
        dataUrl: cropCanvas.toDataURL('image/png'),
        width,
        height
      };
    }

    return null;
  };

  const handleSaveToDatabase = async () => {
    if (!user) {
      toast({
        title: 'Authentication required',
        description: 'Please sign in to save images',
        variant: 'destructive',
      });
      return;
    }

    const croppedData = getCroppedImageData();
    if (!croppedData) return;

    setSaving(true);

    try {
      const { error } = await supabase.from('cropped_images').insert({
        user_id: user.id,
        image_data: croppedData.dataUrl,
        width: Math.round(croppedData.width),
        height: Math.round(croppedData.height),
        original_filename: originalFilename,
      });

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Image saved to your account',
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save image',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = () => {
    const croppedData = getCroppedImageData();
    if (!croppedData) return;

    const link = document.createElement('a');
    link.download = 'cropped-image.png';
    link.href = croppedData.dataUrl;
    link.click();
  };

  const handleReset = () => {
    setZoom(1);
    setImagePosition({ x: 0, y: 0 });
    setCropArea(null);
    setPolygonPoints([]);
  };

  const handleClearPolygon = () => {
    setPolygonPoints([]);
  };

  const handleSignOut = async () => {
    await signOut();
    router.push('/login');
  };

  return (
    <div className="w-full min-h-screen bg-gradient-to-br from-cyan-400 via-blue-500 to-indigo-600 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-4xl font-bold text-white drop-shadow-lg mb-2">Image Cropper</h1>
            <p className="text-cyan-50">Upload, zoom, and crop your images with precision</p>
          </div>
          <div className="flex items-center gap-4">
            {user && (
              <>
                <span className="text-sm text-white bg-white/20 backdrop-blur-sm px-3 py-1.5 rounded-full">{user.email}</span>
                <Button variant="outline" size="sm" onClick={handleSignOut} className="bg-white/20 backdrop-blur-sm border-white/40 text-white hover:bg-white/30">
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign Out
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="grid lg:grid-cols-[1fr_320px] gap-6">
          <Card className="p-6 bg-white/95 backdrop-blur-sm shadow-2xl border-2 border-white/50">
            <div className="mb-6 space-y-4">
              <div className="flex gap-3 flex-wrap">
                <label htmlFor="image-upload">
                  <Button variant="default" className="cursor-pointer bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700" asChild>
                    <span>
                      <Upload className="w-4 h-4 mr-2" />
                      Upload Image
                    </span>
                  </Button>
                  <input
                    id="image-upload"
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                </label>
                <Button
                  variant="outline"
                  onClick={handleReset}
                  disabled={!image}
                  className="border-2"
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Reset
                </Button>
                <Button
                  variant="default"
                  onClick={handleSaveToDatabase}
                  disabled={(cropMode === 'rectangle' && (!cropArea || cropArea.width === 0)) || (cropMode === 'polygon' && polygonPoints.length < 3) || saving}
                  className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {saving ? 'Saving...' : 'Save to Account'}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleDownload}
                  disabled={(cropMode === 'rectangle' && (!cropArea || cropArea.width === 0)) || (cropMode === 'polygon' && polygonPoints.length < 3)}
                  className="border-2"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download
                </Button>
              </div>

              <div className="flex gap-3 items-center bg-gradient-to-r from-slate-50 to-slate-100 p-3 rounded-lg border-2 border-slate-200">
                <span className="text-sm font-semibold text-slate-700">Crop Mode:</span>
                <Button
                  variant={cropMode === 'rectangle' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => { setCropMode('rectangle'); setPolygonPoints([]); setCropArea(null); }}
                  className={cropMode === 'rectangle' ? 'bg-gradient-to-r from-green-500 to-emerald-600' : ''}
                >
                  <Square className="w-4 h-4 mr-2" />
                  Rectangle
                </Button>
                <Button
                  variant={cropMode === 'polygon' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => { setCropMode('polygon'); setCropArea(null); setPolygonPoints([]); }}
                  className={cropMode === 'polygon' ? 'bg-gradient-to-r from-pink-500 to-rose-600' : ''}
                >
                  <Pentagon className="w-4 h-4 mr-2" />
                  Polygon
                </Button>
                {cropMode === 'polygon' && polygonPoints.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleClearPolygon}
                    className="border-rose-300 text-rose-600 hover:bg-rose-50"
                  >
                    Clear Points
                  </Button>
                )}
              </div>
            </div>

            <div className="relative bg-slate-900 rounded-lg overflow-hidden" style={{ height: '600px' }}>
              {!image ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center text-slate-400">
                    <Upload className="w-16 h-16 mx-auto mb-4 opacity-50" />
                    <p className="text-lg">Upload an image to get started</p>
                  </div>
                </div>
              ) : (
                <>
                  <canvas
                    ref={canvasRef}
                    width={800}
                    height={600}
                    className="w-full h-full cursor-crosshair"
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                  />
                  <img
                    ref={imageRef}
                    src={image}
                    alt="Source"
                    className="hidden"
                    onLoad={drawImage}
                  />
                </>
              )}
            </div>
          </Card>

          <div className="space-y-6">
            <Card className="p-6 bg-white/95 backdrop-blur-sm shadow-2xl border-2 border-white/50">
              <h3 className="text-lg font-semibold mb-4 flex items-center bg-gradient-to-r from-cyan-600 to-blue-600 bg-clip-text text-transparent">
                <ZoomIn className="w-5 h-5 mr-2 text-cyan-600" />
                Zoom Controls
              </h3>
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <ZoomOut className="w-4 h-4 text-slate-600" />
                  <Slider
                    value={[zoom]}
                    onValueChange={handleZoomChange}
                    min={0.5}
                    max={3}
                    step={0.1}
                    disabled={!image}
                    className="flex-1"
                  />
                  <ZoomIn className="w-4 h-4 text-slate-600" />
                </div>
                <div className="text-center bg-gradient-to-r from-cyan-500 to-blue-600 text-white py-2 rounded-lg">
                  <span className="text-2xl font-bold">{Math.round(zoom * 100)}%</span>
                </div>
              </div>
            </Card>

            <Card className="p-6 bg-white/95 backdrop-blur-sm shadow-2xl border-2 border-white/50">
              <h3 className="text-lg font-semibold mb-4 bg-gradient-to-r from-pink-600 to-rose-600 bg-clip-text text-transparent">Instructions</h3>
              {cropMode === 'rectangle' ? (
                <ol className="space-y-3 text-sm text-slate-700">
                  <li className="flex gap-2">
                    <span className="font-semibold text-emerald-600">1.</span>
                    <span>Upload an image using the button above</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-emerald-600">2.</span>
                    <span>Use the zoom slider to adjust the view</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-emerald-600">3.</span>
                    <span>Click and drag on the image to draw a rectangle</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-emerald-600">4.</span>
                    <span>Save or download your cropped image</span>
                  </li>
                </ol>
              ) : (
                <ol className="space-y-3 text-sm text-slate-700">
                  <li className="flex gap-2">
                    <span className="font-semibold text-pink-600">1.</span>
                    <span>Upload an image using the button above</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-pink-600">2.</span>
                    <span>Click on the image to add polygon points</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-pink-600">3.</span>
                    <span>Add at least 3 points to create a polygon</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-pink-600">4.</span>
                    <span>The polygon will auto-close around your points</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-pink-600">5.</span>
                    <span>Save or download your cropped image</span>
                  </li>
                </ol>
              )}
            </Card>

            {cropMode === 'rectangle' && cropArea && cropArea.width !== 0 && (
              <Card className="p-6 bg-gradient-to-br from-emerald-50 to-teal-50 shadow-2xl border-2 border-emerald-200">
                <h3 className="text-lg font-semibold mb-4 bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">Rectangle Info</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-700">Width:</span>
                    <span className="font-bold text-emerald-700">{Math.abs(Math.round(cropArea.width))}px</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-700">Height:</span>
                    <span className="font-bold text-emerald-700">{Math.abs(Math.round(cropArea.height))}px</span>
                  </div>
                </div>
              </Card>
            )}

            {cropMode === 'polygon' && polygonPoints.length > 0 && (
              <Card className="p-6 bg-gradient-to-br from-pink-50 to-rose-50 shadow-2xl border-2 border-pink-200">
                <h3 className="text-lg font-semibold mb-4 bg-gradient-to-r from-pink-600 to-rose-600 bg-clip-text text-transparent">Polygon Info</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-700">Points:</span>
                    <span className="font-bold text-pink-700">{polygonPoints.length}</span>
                  </div>
                  {polygonPoints.length >= 3 && (
                    <div className="mt-2 p-2 bg-white rounded text-xs text-center text-green-600 font-semibold">
                      ✓ Ready to crop
                    </div>
                  )}
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>

      <canvas ref={cropCanvasRef} className="hidden" />
    </div>
  );
}
