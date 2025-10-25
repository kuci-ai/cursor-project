'use client';

import ImageCropper from '@/components/ImageCropper';
import ProtectedRoute from '@/components/ProtectedRoute';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
        <div className="container mx-auto p-6">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-foreground mb-2">Image Processing Tools</h1>
            <p className="text-muted-foreground">Choose your tool below</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div className="border rounded-lg p-6 border-border">
              <h2 className="text-xl font-semibold mb-4 text-foreground">Image Cropper</h2>
              <p className="text-muted-foreground mb-4">Crop and save your images with precision</p>
              <Link href="/">
                <Button className="w-full">Use Image Cropper</Button>
              </Link>
            </div>
            
            <div className="border rounded-lg p-6 border-border">
              <h2 className="text-xl font-semibold mb-4 text-foreground">Thermal Viewer</h2>
              <p className="text-muted-foreground mb-4">View thermal images from FLIR/FLUKE CSV files</p>
              <Link href="/thermal">
                <Button className="w-full">Use Thermal Viewer</Button>
              </Link>
            </div>
          </div>
          
          <div className="border rounded-lg p-6 border-border">
            <h2 className="text-xl font-semibold mb-4 text-foreground">Image Cropper</h2>
            <ImageCropper />
          </div>
        </div>
      </div>
  );
}
