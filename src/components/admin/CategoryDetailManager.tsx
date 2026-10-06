"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ExternalLink,
  GripVertical,
  ImagePlus,
  Layers3,
  Package,
  Pencil,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import {
  deleteCategory,
  reorderCategories,
  updateCategory,
  uploadCategoryImage,
} from "@/actions/categories";
import { useToast } from "@/components/ui/Toast";
import type { Category } from "@/lib/types";
import { CategoryFormModal } from "./CategoryFormModal";

function SubcategoryRow({
  subcategory,
  onEdit,
  onDelete,
}: {
  subcategory: Category;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: subcategory.id,
  });

  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="grid grid-cols-[auto_48px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-slate-200 bg-white p-3"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Mover ${subcategory.name}`}
        className="cursor-grab rounded-lg p-1.5 text-slate-300 transition hover:bg-slate-50 hover:text-slate-600"
      >
        <GripVertical size={17} aria-hidden="true" />
      </button>
      <div className="relative h-12 w-12 overflow-hidden rounded-xl bg-slate-100">
        {subcategory.image_url ? (
          <Image src={subcategory.image_url} alt="" fill sizes="48px" className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm font-semibold text-slate-300">
            {subcategory.name.charAt(0)}
          </div>
        )}
      </div>
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold text-slate-900">{subcategory.name}</h3>
        <p className="mt-0.5 truncate text-xs text-slate-400">/{subcategory.slug}</p>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Editar ${subcategory.name}`}
          className="rounded-lg p-2 text-slate-400 transition hover:bg-orbita-cyan-soft hover:text-orbita-cyan-dark"
        >
          <Pencil size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Eliminar ${subcategory.name}`}
          className="rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}

export function CategoryDetailManager({
  category,
  initialSubcategories,
  directProductCount,
}: {
  category: Category;
  initialSubcategories: Category[];
  directProductCount: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(category.name);
  const [imageUrl, setImageUrl] = useState<string | null>(category.image_url);
  const [subcategories, setSubcategories] = useState(initialSubcategories);
  const [modalCategory, setModalCategory] = useState<Category | null | "new">(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleSave() {
    if (!name.trim()) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateCategory(category.id, { name, imageUrl });
      if ("error" in result) {
        const message = result.error ?? "No fue posible guardar la categoría.";
        setError(message);
        toast.error("No se pudo guardar la categoría", { description: message });
        return;
      }
      setSaved(true);
      toast.success("Categoría actualizada", { description: name.trim() });
      router.refresh();
    });
  }

  async function handleImagePick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    const toastId = toast.loading("Subiendo imagen...", { description: file.name });
    const formData = new FormData();
    formData.append("file", file);
    const result = await uploadCategoryImage(category.id, formData);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";

    if ("error" in result) {
      const message = result.error ?? "No fue posible cargar la imagen.";
      setError(message);
      toast.update(toastId, {
        variant: "error",
        title: "No se pudo subir la imagen",
        description: message,
      });
      return;
    }

    setImageUrl(result.url ?? null);
    setSaved(true);
    toast.update(toastId, {
      variant: "success",
      title: "Imagen subida correctamente",
      description: null,
    });
    router.refresh();
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const previous = subcategories;
    const oldIndex = subcategories.findIndex((item) => item.id === active.id);
    const newIndex = subcategories.findIndex((item) => item.id === over.id);
    const reordered = arrayMove(subcategories, oldIndex, newIndex);
    setSubcategories(reordered);
    startTransition(async () => {
      const result = await reorderCategories(reordered.map((item) => item.id));
      if ("error" in result) {
        setSubcategories(previous);
        toast.error("No se pudo guardar el nuevo orden", { description: result.error });
        return;
      }
      toast.success("Orden de subcategorías actualizado");
      router.refresh();
    });
  }

  async function handleDelete(subcategory: Category) {
    if (!confirm(`¿Eliminar la subcategoría “${subcategory.name}”?`)) return;
    setError(null);
    const result = await deleteCategory(subcategory.id);
    if (result && "error" in result) {
      const message = result.error ?? "No fue posible eliminar la subcategoría.";
      setError(message);
      toast.error("No se pudo eliminar la subcategoría", { description: message });
      return;
    }
    setSubcategories((items) => items.filter((item) => item.id !== subcategory.id));
    toast.success("Subcategoría eliminada", { description: subcategory.name });
    router.refresh();
  }

  return (
    <div className="grid grid-flow-dense grid-cols-1 gap-4 xl:grid-cols-12">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 xl:col-span-5">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-orbita-cyan-dark">
              Categoría principal
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-slate-950">
              Identidad y portada
            </h2>
          </div>
          <Link
            href={`/?categoria=${category.slug}`}
            target="_blank"
            rel="noreferrer"
            aria-label={`Abrir ${category.name} en el catálogo`}
            className="rounded-xl border border-slate-200 p-2.5 text-slate-500 transition hover:border-orbita-cyan hover:text-orbita-cyan-dark"
          >
            <ExternalLink size={17} aria-hidden="true" />
          </Link>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-2xl bg-slate-100">
            {imageUrl ? (
              <Image src={imageUrl} alt={name} fill sizes="112px" className="object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-3xl font-semibold text-slate-300">
                {name.charAt(0)}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-orbita-cyan hover:bg-orbita-cyan-soft disabled:opacity-60"
            >
              <ImagePlus size={17} aria-hidden="true" />
              {uploading ? "Subiendo..." : imageUrl ? "Cambiar imagen" : "Agregar imagen"}
            </button>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              Esta imagen aparece en el carrusel público de categorías.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImagePick}
            />
          </div>
        </div>

        <label className="mt-5 block text-sm font-medium text-slate-700">
          Nombre de la categoría
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setSaved(false);
            }}
            className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none transition focus:border-orbita-cyan focus:ring-2 focus:ring-orbita-cyan/15"
          />
        </label>

        <div className="mt-4 rounded-xl bg-slate-50 px-3.5 py-3">
          <p className="text-xs font-medium text-slate-500">URL pública</p>
          <p className="mt-1 break-all text-xs text-slate-700">/?categoria={category.slug}</p>
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {saved && !error && <p className="mt-3 text-sm text-emerald-600">Cambios guardados.</p>}

        <button
          type="button"
          onClick={handleSave}
          disabled={pending || !name.trim()}
          className="mt-5 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-orbita-navy px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orbita-navy-soft disabled:opacity-60"
        >
          <Save size={17} aria-hidden="true" />
          {pending ? "Guardando..." : "Guardar categoría"}
        </button>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 xl:col-span-7">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-orbita-cyan-dark">
              Organización
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-slate-950">
              Subcategorías de {category.name}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Cada elemento creado aquí quedará asociado únicamente a esta categoría.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setModalCategory("new")}
            className="flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-orbita-cyan px-4 py-2 text-sm font-semibold text-orbita-navy transition hover:bg-[#78c5d7]"
          >
            <Plus size={17} aria-hidden="true" />
            Nueva subcategoría
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-orbita-cyan-soft p-3.5">
            <Layers3 size={18} className="text-orbita-cyan-dark" aria-hidden="true" />
            <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-orbita-navy">
              {subcategories.length}
            </p>
            <p className="text-xs text-slate-500">Subcategorías</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3.5">
            <Package size={18} className="text-slate-500" aria-hidden="true" />
            <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-900">
              {directProductCount}
            </p>
            <p className="text-xs text-slate-500">Productos directos</p>
          </div>
        </div>

        {subcategories.length > 0 ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext
              items={subcategories.map((subcategory) => subcategory.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="mt-4 space-y-2">
                {subcategories.map((subcategory) => (
                  <SubcategoryRow
                    key={subcategory.id}
                    subcategory={subcategory}
                    onEdit={() => setModalCategory(subcategory)}
                    onDelete={() => handleDelete(subcategory)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 px-5 py-10 text-center">
            <Layers3 size={24} className="mx-auto text-slate-300" aria-hidden="true" />
            <p className="mt-3 text-sm font-semibold text-slate-700">Sin subcategorías todavía</p>
            <p className="mt-1 text-sm text-slate-500">
              Crea la primera para segmentar los productos de {category.name}.
            </p>
          </div>
        )}
      </section>

      {modalCategory && (
        <CategoryFormModal
          parentId={category.id}
          category={modalCategory === "new" ? null : modalCategory}
          onClose={() => {
            setModalCategory(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
