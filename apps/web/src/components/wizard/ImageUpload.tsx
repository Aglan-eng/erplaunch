import React, { useRef, useState, useCallback } from 'react';
import { ImagePlus, X, Upload, Loader, ChevronDown, ChevronRight, Paperclip } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { engagementsApi } from '@/lib/api';

interface ImageUploadProps {
  engagementId: string;
  sectionKey: string;
}

interface SectionImage {
  id: string;
  engagementId: string;
  sectionKey: string;
  filename: string;
  originalName: string;
  mimeType: string;
  createdAt: string;
}

export function ImageUpload({ engagementId, sectionKey }: ImageUploadProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  // Load images for this engagement
  const { data: allImages } = useQuery({
    queryKey: ['images', engagementId],
    queryFn: () => engagementsApi.getImages(engagementId),
    enabled: !!engagementId,
  });

  const images = (allImages as SectionImage[] | undefined)?.filter(
    (img) => img.sectionKey === sectionKey
  ) ?? [];

  // Auto-open if images exist
  const hasImages = images.length > 0;

  const uploadMutation = useMutation({
    mutationFn: (file: File) => engagementsApi.uploadImage(engagementId, sectionKey, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['images', engagementId] });
      setUploading(false);
      setIsOpen(true);
    },
    onError: () => setUploading(false),
  });

  const deleteMutation = useMutation({
    mutationFn: (imageId: string) => engagementsApi.deleteImage(engagementId, imageId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['images', engagementId] }),
  });

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    setValidationError(null);
    const file = files[0];
    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      setValidationError('Only PNG, JPG, WEBP, GIF files are allowed.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setValidationError('File size must be under 5MB.');
      return;
    }
    setUploading(true);
    uploadMutation.mutate(file);
  }, [uploadMutation]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const getImageUrl = (img: SectionImage) =>
    `${baseUrl}/uploads/${img.engagementId}/${img.filename}`;

  return (
    <>
      <div className="rounded-2xl border border-slate-200/80 bg-white overflow-hidden shadow-sm transition-all hover:shadow-md">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-50/50 transition-colors"
        >
          <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
            <Paperclip className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-bold text-slate-800">Attachments</span>
            {hasImages && (
              <span className="ml-2 text-xs text-slate-400">
                {images.length} image{images.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {isOpen || hasImages ? (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-slate-400" />
          )}
        </button>

        {(isOpen || hasImages) && (
          <div className="px-5 pb-5 animate-in">
            {/* Image grid */}
            {images.length > 0 && (
              <div className="grid grid-cols-3 gap-3 mb-4">
                {images.map((img) => (
                  <div
                    key={img.id}
                    className="group relative rounded-xl overflow-hidden border border-slate-100 bg-slate-50 aspect-square cursor-pointer"
                    onClick={() => setPreviewUrl(getImageUrl(img))}
                  >
                    <img
                      src={getImageUrl(img)}
                      alt={img.originalName}
                      className="w-full h-full object-cover transition-transform group-hover:scale-105"
                    />
                    {/* Delete overlay */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteMutation.mutate(img.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-full bg-red-500 text-white hover:bg-red-600 transition-all active:scale-95"
                        title="Delete image"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {/* Filename */}
                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                      <p className="text-[10px] text-white truncate font-medium">{img.originalName}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Drop zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`
                flex flex-col items-center justify-center gap-2 py-6 rounded-xl border-2 border-dashed cursor-pointer transition-all
                ${isDragging
                  ? 'border-brand-500 bg-brand-50/50'
                  : 'border-slate-200 hover:border-brand-300 hover:bg-slate-50/50'
                }
              `}
            >
              {uploading ? (
                <Loader className="h-6 w-6 text-brand-500 animate-spin" />
              ) : (
                <div className="p-2 rounded-xl bg-slate-100 text-slate-400">
                  <ImagePlus className="h-5 w-5" />
                </div>
              )}
              <div className="text-center">
                <p className="text-xs font-semibold text-slate-600">
                  {uploading ? 'Uploading…' : 'Drop image here or click to browse'}
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  PNG, JPG, WEBP, GIF — max 5MB
                </p>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />

            {validationError && (
              <p className="mt-2 text-xs text-red-500 font-medium">{validationError}</p>
            )}

            <p className="mt-2 text-[11px] text-slate-400">
              Uploaded images will be embedded in generated documents.
            </p>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8 animate-in"
          onClick={() => setPreviewUrl(null)}
        >
          <button
            type="button"
            onClick={() => setPreviewUrl(null)}
            className="absolute top-6 right-6 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={previewUrl}
            alt="Preview"
            className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
