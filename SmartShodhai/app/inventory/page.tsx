"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { FileSearch, PackageSearch, Pencil, Plus, ScanLine, Trash2, Upload, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  PRODUCT_SELECT_FULL_OWNER,
  PRODUCT_SELECT_FULL_STAFF,
  productsSelectQuery,
} from "@/lib/products-query";
import { formatCurrencyBDT, formatNumberBD } from "@/lib/format";
import { fetchUserRole, type UserRole } from "@/lib/user-role";
import { validateImageUpload } from "@/lib/upload";
import {
  sanitizeBarcode,
  sanitizeCategory,
  sanitizeProductName,
  sanitizeUnit,
} from "@/lib/validation";
import type { Product } from "@/types";

type ProductForm = {
  name: string;
  category: string;
  stock_qty: string;
  unit: string;
  cost_price: string;
  selling_price: string;
  reorder_level: string;
  barcode: string;
};

type ToastState = {
  type: "success" | "error";
  message: string;
} | null;

type OcrItem = {
  id: string;
  name: string;
  qty: string;
  unit: string;
  price: string;
  checked: boolean;
};

const categories = ["Dairy", "Dry Goods", "Beverages", "Cooking Oil", "Other"];

const emptyForm: ProductForm = {
  name: "",
  category: "Other",
  stock_qty: "",
  unit: "",
  cost_price: "",
  selling_price: "",
  reorder_level: "",
  barcode: "",
};

function getMarginColor(margin: number) {
  if (margin > 15) return "text-emerald-600";
  if (margin >= 5) return "text-orange-500";
  return "text-red-600";
}

export default function InventoryPage() {
  const scannerRef = useRef<{
    start: (
      cameraConfigOrDeviceId: string | MediaTrackConstraints,
      configuration: object,
      qrCodeSuccessCallback: (decodedText: string) => void,
      qrCodeErrorCallback?: (errorMessage: string) => void
    ) => Promise<unknown>;
    stop: () => Promise<void>;
    clear: () => Promise<void> | void;
  } | null>(null);
  const isProcessingScanRef = useRef(false);
  const handleScannedBarcodeRef = useRef<(barcode: string) => Promise<void>>(async () => {});
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const [scannerMessage, setScannerMessage] = useState("");
  const [scannedBarcode, setScannedBarcode] = useState("");
  const [editingProductId, setEditingProductId] = useState<number | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [toast, setToast] = useState<ToastState>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [isLedgerOpen, setIsLedgerOpen] = useState(false);
  const [ledgerStep, setLedgerStep] = useState<1 | 2 | 3>(1);
  const [ledgerPreview, setLedgerPreview] = useState<string>("");
  const [ledgerImageBase64, setLedgerImageBase64] = useState("");
  const [ledgerMimeType, setLedgerMimeType] = useState("image/jpeg");
  const [isExtracting, setIsExtracting] = useState(false);
  const [isAddingFromLedger, setIsAddingFromLedger] = useState(false);
  const [ocrItems, setOcrItems] = useState<OcrItem[]>([]);
  const [ledgerError, setLedgerError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void loadProducts();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!isScannerOpen) return;
    let isCancelled = false;

    async function startScanner() {
      setScannerError("");
      setScannerMessage("Point your camera at a UPC/EAN barcode.");
      setScannedBarcode("");
      isProcessingScanRef.current = false;

      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
        if (isCancelled) return;

        const scanner = new Html5Qrcode("inventory-barcode-reader");
        scannerRef.current = scanner as typeof scannerRef.current;

        const scannerConfig = {
          fps: 10,
          qrbox: { width: 280, height: 140 },
          formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
          ],
        };

        const onScanSuccess = (decodedText: string) => {
          if (isProcessingScanRef.current) return;
          isProcessingScanRef.current = true;
          const barcode = decodedText.trim();
          setScannedBarcode(barcode);
          setScannerMessage("Barcode scanned. Checking product...");
          void handleScannedBarcodeRef.current(barcode);
        };

        try {
          await scanner.start(
            { facingMode: { exact: "environment" } },
            scannerConfig,
            onScanSuccess,
            () => {}
          );
        } catch {
          try {
            await scanner.start(
              { facingMode: "environment" },
              scannerConfig,
              onScanSuccess,
              () => {}
            );
          } catch {
            const cameras = await Html5Qrcode.getCameras();
            if (!cameras.length) {
              setScannerError("No camera found on this device.");
              return;
            }
            await scanner.start(cameras[0].id, scannerConfig, onScanSuccess, () => {});
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown scanner error.";
        const permissionDenied =
          message.includes("NotAllowedError") ||
          message.toLowerCase().includes("permission") ||
          message.toLowerCase().includes("denied");

        setScannerError(
          permissionDenied
            ? "Camera permission denied. Please allow camera access in browser settings and try again."
            : `Unable to start scanner: ${message}`
        );
      }
    }

    void startScanner();

    return () => {
      isCancelled = true;
      void stopScannerInstance();
    };
  }, [isScannerOpen]);

  async function loadProducts() {
    setIsLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setProducts([]);
        setIsLoading(false);
        return;
      }

      const role = await fetchUserRole(supabase, user.id);
      setUserRole(role);

      const { data, error } = await productsSelectQuery(supabase, user.id, role).order(
        "name",
        { ascending: true }
      );

      if (error) {
        setToast({ type: "error", message: "Failed to load inventory." });
        setProducts([]);
        return;
      }

      setProducts((data ?? []) as Product[]);
    } catch {
      setToast({ type: "error", message: "Failed to load inventory." });
      setProducts([]);
    } finally {
      setIsLoading(false);
    }
  }

  function openAddModal() {
    setEditingProductId(null);
    setForm(emptyForm);
    setIsModalOpen(true);
  }

  function openEditModal(product: Product) {
    setEditingProductId(product.id);
    setForm({
      name: product.name ?? "",
      category: product.category ?? "Other",
      stock_qty: String(product.stock_qty ?? ""),
      unit: product.unit ?? "",
      cost_price: product.cost_price != null ? String(product.cost_price) : "",
      selling_price: product.selling_price != null ? String(product.selling_price) : "",
      reorder_level: String(product.reorder_level ?? ""),
      barcode: product.barcode ?? "",
    });
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
    setEditingProductId(null);
    setForm(emptyForm);
  }

  function openScannerModal() {
    setIsScannerOpen(true);
  }

  async function stopScannerInstance() {
    if (!scannerRef.current) return;
    try {
      await scannerRef.current.stop();
    } catch {
      // Scanner may already be stopped.
    }
    try {
      await scannerRef.current.clear();
    } catch {
      // Ignore cleanup errors.
    }
    scannerRef.current = null;
  }

  async function closeScannerModal() {
    await stopScannerInstance();
    setIsScannerOpen(false);
    setScannerMessage("");
    setScannerError("");
    isProcessingScanRef.current = false;
  }

  function resetLedgerState() {
    if (ledgerPreview) {
      URL.revokeObjectURL(ledgerPreview);
    }
    setLedgerStep(1);
    setLedgerPreview("");
    setLedgerImageBase64("");
    setLedgerMimeType("image/jpeg");
    setIsExtracting(false);
    setIsAddingFromLedger(false);
    setOcrItems([]);
    setLedgerError("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function openLedgerModal() {
    resetLedgerState();
    setIsLedgerOpen(true);
  }

  function closeLedgerModal() {
    setIsLedgerOpen(false);
    resetLedgerState();
  }

  async function fileToBase64(file: File) {
    const reader = new FileReader();
    return await new Promise<string>((resolve, reject) => {
      reader.onload = () => {
        const result = String(reader.result ?? "");
        const commaIndex = result.indexOf(",");
        if (commaIndex === -1) {
          reject(new Error("Invalid image data."));
          return;
        }
        resolve(result.slice(commaIndex + 1));
      };
      reader.onerror = () => reject(new Error("Failed to read image file."));
      reader.readAsDataURL(file);
    });
  }

  async function handleLedgerFile(file: File) {
    const uploadError = validateImageUpload(file);
    if (uploadError) {
      setLedgerError(uploadError);
      return;
    }

    const validTypes = ["image/jpeg", "image/png", "image/heic", "image/heif"];
    if (!validTypes.includes(file.type)) {
      setLedgerError("Please upload JPG, PNG, or HEIC image.");
      return;
    }

    try {
      const base64 = await fileToBase64(file);
      if (ledgerPreview) {
        URL.revokeObjectURL(ledgerPreview);
      }
      setLedgerImageBase64(base64);
      setLedgerMimeType(file.type || "image/jpeg");
      setLedgerPreview(URL.createObjectURL(file));
      setLedgerError("");
      setLedgerStep(1);
    } catch {
      setLedgerError("Could not process this file. Try another image.");
    }
  }

  async function handleExtractLedgerData() {
    if (!ledgerImageBase64) {
      setLedgerError("Please upload an image first.");
      return;
    }

    setIsExtracting(true);
    setLedgerError("");
    setLedgerStep(2);

    try {
      const response = await fetch("/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: ledgerImageBase64,
          mimeType: ledgerMimeType,
        }),
      });

      const json = (await response.json()) as {
        items?: Array<{ name: string; qty: number; unit?: string; price?: number }>;
        error?: string;
        warning?: string;
      };

      if (!response.ok) {
        setLedgerError(json.error || "Image unclear — try again with better lighting");
        setIsExtracting(false);
        return;
      }

      if (json.warning && (!json.items || json.items.length === 0)) {
        setLedgerError(json.warning);
        setIsExtracting(false);
        return;
      }

      if (!json.items || json.items.length === 0) {
        setLedgerError("Image unclear — try again with better lighting");
        setIsExtracting(false);
        return;
      }

      const mapped: OcrItem[] = json.items.map((item, index) => ({
        id: `${Date.now()}-${index}`,
        name: item.name ?? "",
        qty: String(item.qty ?? ""),
        unit: item.unit ?? "pcs",
        price: item.price != null ? String(item.price) : "",
        checked: true,
      }));

      if (mapped.length === 0) {
        setLedgerError("Image unclear — try again with better lighting");
        setIsExtracting(false);
        return;
      }

      setOcrItems(mapped);
      setLedgerStep(3);
    } catch {
      setLedgerError("Image unclear — try again with better lighting");
    } finally {
      setIsExtracting(false);
    }
  }

  async function handleAddExtractedItems() {
    const selected = ocrItems.filter((item) => item.checked && item.name.trim() && item.qty.trim());
    if (selected.length === 0) {
      setToast({ type: "error", message: "Select at least one valid item to add." });
      return;
    }

    setIsAddingFromLedger(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setToast({ type: "error", message: "You must be signed in to add items." });
      setIsAddingFromLedger(false);
      return;
    }

    const payload = selected.map((item) => ({
      owner_id: user.id,
      name: sanitizeProductName(item.name),
      stock_qty: Number(item.qty),
      unit: sanitizeUnit(item.unit) || "pcs",
      selling_price: item.price ? Number(item.price) : null,
      cost_price: null,
      reorder_level: 0,
      category: "Other",
      barcode: null,
    }));

    const role = await fetchUserRole(supabase, user.id);
    setUserRole(role);

    const { data, error } =
      role === "owner"
        ? await supabase.from("products").insert(payload).select(PRODUCT_SELECT_FULL_OWNER)
        : await supabase.from("products").insert(payload).select(PRODUCT_SELECT_FULL_STAFF);

    if (error) {
      setToast({ type: "error", message: "Failed to add extracted items." });
      setIsAddingFromLedger(false);
      return;
    }

    setProducts((prev) =>
      [...prev, ...((data ?? []) as Product[])].sort((a, b) => a.name.localeCompare(b.name))
    );
    setToast({ type: "success", message: `${selected.length} items added to inventory` });
    setIsAddingFromLedger(false);
    closeLedgerModal();
  }

  async function handleScannedBarcode(barcode: string) {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setToast({ type: "error", message: "You must be signed in to scan products." });
        isProcessingScanRef.current = false;
        return;
      }

      const role = await fetchUserRole(supabase, user.id);
      setUserRole(role);

      const { data, error } = await productsSelectQuery(supabase, user.id, role)
        .eq("barcode", barcode)
        .maybeSingle();

      if (error) {
        setToast({ type: "error", message: "Failed to query product by barcode." });
        setScannerError("Could not look up this barcode. Please try again.");
        isProcessingScanRef.current = false;
        return;
      }

      await closeScannerModal();

      if (data) {
        openEditModal(data as Product);
        setToast({ type: "success", message: "Product found. You can now update stock." });
        return;
      }

      setEditingProductId(null);
      setForm({
        ...emptyForm,
        barcode,
      });
      setIsModalOpen(true);
      setToast({ type: "success", message: "No product found. Add details to create new item." });
    } catch {
      setToast({ type: "error", message: "Failed to query product by barcode." });
      setScannerError("Could not look up this barcode. Please try again.");
      isProcessingScanRef.current = false;
    }
  }

  handleScannedBarcodeRef.current = handleScannedBarcode;

  async function handleDelete(product: Product) {
    const confirmed = window.confirm(
      `Delete "${product.name}"? This action cannot be undone.`
    );
    if (!confirmed) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setToast({ type: "error", message: "You must be signed in to delete products." });
      return;
    }

    const { error } = await supabase
      .from("products")
      .delete()
      .eq("owner_id", user.id)
      .eq("id", product.id);
    if (error) {
      setToast({ type: "error", message: "Failed to delete product." });
      return;
    }

    setProducts((prev) => prev.filter((p) => p.id !== product.id));
    setToast({ type: "success", message: "Product deleted successfully." });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name.trim() || !form.stock_qty.trim()) {
      setToast({ type: "error", message: "Product name and stock quantity are required." });
      return;
    }

    setIsSaving(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setToast({ type: "error", message: "You must be signed in to save products." });
      setIsSaving(false);
      return;
    }

    const role = await fetchUserRole(supabase, user.id);
    setUserRole(role);

    const payload: Record<string, unknown> = {
      name: sanitizeProductName(form.name),
      category: sanitizeCategory(form.category),
      stock_qty: Number(form.stock_qty || 0),
      unit: sanitizeUnit(form.unit),
      selling_price: form.selling_price ? Number(form.selling_price) : null,
      reorder_level: Number(form.reorder_level || 0),
      barcode: form.barcode.trim() ? sanitizeBarcode(form.barcode) : null,
    };
    if (role === "owner") {
      payload.cost_price = form.cost_price ? Number(form.cost_price) : null;
    }

    if (editingProductId == null) {
      const { data, error } =
        role === "owner"
          ? await supabase
              .from("products")
              .insert({ ...payload, owner_id: user.id })
              .select(PRODUCT_SELECT_FULL_OWNER)
              .single()
          : await supabase
              .from("products")
              .insert({ ...payload, owner_id: user.id })
              .select(PRODUCT_SELECT_FULL_STAFF)
              .single();

      if (error) {
        setToast({ type: "error", message: "Failed to add product." });
        setIsSaving(false);
        return;
      }

      setProducts((prev) => [...prev, data as Product].sort((a, b) => a.name.localeCompare(b.name)));
      setToast({ type: "success", message: "Product added successfully." });
      setIsSaving(false);
      closeModal();
      return;
    }

    const { data, error } =
      role === "owner"
        ? await supabase
            .from("products")
            .update(payload)
            .eq("owner_id", user.id)
            .eq("id", editingProductId)
            .select(PRODUCT_SELECT_FULL_OWNER)
            .single()
        : await supabase
            .from("products")
            .update(payload)
            .eq("owner_id", user.id)
            .eq("id", editingProductId)
            .select(PRODUCT_SELECT_FULL_STAFF)
            .single();

    if (error) {
      setToast({ type: "error", message: "Failed to update product." });
      setIsSaving(false);
      return;
    }

    setProducts((prev) =>
      prev
        .map((p) => (p.id === editingProductId ? (data as Product) : p))
        .sort((a, b) => a.name.localeCompare(b.name))
    );
    setToast({ type: "success", message: "Product updated successfully." });
    setIsSaving(false);
    closeModal();
  }

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const matchesSearch = product.name.toLowerCase().includes(search.toLowerCase());
      const matchesCategory =
        categoryFilter === "All" ? true : (product.category ?? "Other") === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [products, search, categoryFilter]);
  const tableColumnCount = userRole === "owner" ? 8 : 6;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-bold text-indigo-700">Inventory</h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={openScannerModal}
            className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-50"
          >
            <ScanLine className="h-4 w-4" />
            Scan Barcode
          </button>
          <button
            type="button"
            onClick={openLedgerModal}
            className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-50"
          >
            <FileSearch className="h-4 w-4" />
            Scan Ledger
          </button>
          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-800"
          >
            <Plus className="h-4 w-4" />
            Add Product
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="md:col-span-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by product name..."
            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none ring-indigo-200 transition focus:border-indigo-500 focus:ring-2"
          />
        </div>
        <div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none ring-indigo-200 transition focus:border-indigo-500 focus:ring-2"
          >
            <option value="All">All Categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-100">
        <table className="min-w-[920px] divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                Name
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                Stock Qty
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                Unit
              </th>
              {userRole === "owner" && (
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Cost Price (৳)
                </th>
              )}
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                Selling Price (৳)
              </th>
              {userRole === "owner" && (
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Profit Margin (%)
                </th>
              )}
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                Reorder Level
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr className="animate-pulse">
                <td colSpan={tableColumnCount} className="px-4 py-8">
                  <div className="space-y-2">
                    <div className="loading-skeleton h-4 w-full" />
                    <div className="loading-skeleton h-4 w-10/12" />
                    <div className="loading-skeleton h-4 w-8/12" />
                  </div>
                </td>
              </tr>
            ) : filteredProducts.length === 0 ? (
              <tr>
                <td colSpan={tableColumnCount} className="px-4 py-8 text-center text-sm text-slate-500">
                  <div className="flex flex-col items-center gap-2">
                    <PackageSearch className="h-7 w-7 text-slate-400" />
                    <p>No products yet — add your first product</p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredProducts.map((product) => {
                const cost = product.cost_price ?? 0;
                const selling = product.selling_price ?? 0;
                const margin = cost > 0 ? ((selling - cost) / cost) * 100 : 0;
                const lowStock = product.stock_qty <= product.reorder_level;

                return (
                  <tr key={product.id}>
                    <td className="px-4 py-3 text-sm font-medium text-slate-700">{product.name}</td>
                    <td className={`px-4 py-3 text-sm ${lowStock ? "font-semibold text-red-600" : "text-slate-600"}`}>
                      {formatNumberBD(product.stock_qty)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{product.unit}</td>
                    {userRole === "owner" && (
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {product.cost_price != null ? formatCurrencyBDT(product.cost_price) : "-"}
                      </td>
                    )}
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {product.selling_price != null
                        ? formatCurrencyBDT(product.selling_price)
                        : "-"}
                    </td>
                    {userRole === "owner" && (
                      <td className={`px-4 py-3 text-sm font-semibold ${getMarginColor(margin)}`}>
                        {margin.toFixed(2)}%
                      </td>
                    )}
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {formatNumberBD(product.reorder_level)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openEditModal(product)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(product)}
                          className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={closeModal}
        >
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-800">
                {editingProductId == null ? "Add Product" : "Edit Product"}
              </h3>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-md p-1 text-slate-500 transition hover:bg-slate-100"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 p-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-sm font-medium text-slate-700">Product Name *</span>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-indigo-200 focus:border-indigo-500 focus:ring-2"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-sm font-medium text-slate-700">Category</span>
                  <select
                    value={form.category}
                    onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-indigo-200 focus:border-indigo-500 focus:ring-2"
                  >
                    {categories.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-sm font-medium text-slate-700">Stock Quantity *</span>
                  <input
                    type="number"
                    min="0"
                    value={form.stock_qty}
                    onChange={(e) => setForm((prev) => ({ ...prev, stock_qty: e.target.value }))}
                    required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-indigo-200 focus:border-indigo-500 focus:ring-2"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-sm font-medium text-slate-700">Unit</span>
                  <input
                    type="text"
                    placeholder="pcs / kg / litre / carton"
                    value={form.unit}
                    onChange={(e) => setForm((prev) => ({ ...prev, unit: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-indigo-200 focus:border-indigo-500 focus:ring-2"
                  />
                </label>

                {userRole === "owner" && (
                  <label className="space-y-1">
                    <span className="text-sm font-medium text-slate-700">Cost Price (৳)</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.cost_price}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, cost_price: e.target.value }))
                      }
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-indigo-200 focus:border-indigo-500 focus:ring-2"
                    />
                  </label>
                )}

                <label className="space-y-1">
                  <span className="text-sm font-medium text-slate-700">Selling Price (৳)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.selling_price}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, selling_price: e.target.value }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-indigo-200 focus:border-indigo-500 focus:ring-2"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-sm font-medium text-slate-700">Reorder Level</span>
                  <input
                    type="number"
                    min="0"
                    value={form.reorder_level}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, reorder_level: e.target.value }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-indigo-200 focus:border-indigo-500 focus:ring-2"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-sm font-medium text-slate-700">Barcode (optional)</span>
                  <input
                    type="text"
                    value={form.barcode}
                    onChange={(e) => setForm((prev) => ({ ...prev, barcode: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-indigo-200 focus:border-indigo-500 focus:ring-2"
                  />
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSaving
                    ? editingProductId == null
                      ? "Adding..."
                      : "Saving..."
                    : editingProductId == null
                      ? "Add Product"
                      : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isScannerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
          onClick={() => void closeScannerModal()}
        >
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-800">Scan Barcode</h3>
              <button
                type="button"
                onClick={() => void closeScannerModal()}
                className="rounded-md p-1 text-slate-500 transition hover:bg-slate-100"
                aria-label="Close scanner"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div
                id="inventory-barcode-reader"
                className="min-h-[260px] overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
              />

              {scannedBarcode && (
                <p className="rounded-lg bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700">
                  Scanned Barcode: <span className="font-bold">{scannedBarcode}</span>
                </p>
              )}

              {scannerMessage && <p className="text-sm text-slate-600">{scannerMessage}</p>}
              {scannerError && <p className="text-sm font-medium text-red-600">{scannerError}</p>}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void closeScannerModal()}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Stop Scanner
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isLedgerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
          onClick={closeLedgerModal}
        >
          <div className="w-full max-w-4xl rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-800">Scan Ledger</h3>
              <button
                type="button"
                onClick={closeLedgerModal}
                className="rounded-md p-1 text-slate-500 transition hover:bg-slate-100"
                aria-label="Close ledger scan"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div className="flex flex-wrap gap-2">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    ledgerStep === 1
                      ? "bg-indigo-100 text-indigo-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  Step 1 - Upload
                </span>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    ledgerStep === 2
                      ? "bg-indigo-100 text-indigo-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  Step 2 - AI Extraction
                </span>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    ledgerStep === 3
                      ? "bg-indigo-100 text-indigo-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  Step 3 - Review & Confirm
                </span>
              </div>

              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5">
                <p className="mb-3 text-sm text-slate-600">
                  Take a clear photo of your handwritten khata page
                </p>
                <div
                  className="cursor-pointer rounded-lg border border-slate-300 bg-white p-6 text-center"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    if (file) void handleLedgerFile(file);
                  }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="mx-auto mb-2 h-6 w-6 text-slate-500" />
                  <p className="text-sm font-medium text-slate-700">
                    Drag & drop image here, or click to upload
                  </p>
                  <p className="mt-1 text-xs text-slate-500">JPG, PNG, HEIC</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".jpg,.jpeg,.png,.heic,image/jpeg,image/png,image/heic,image/heif"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleLedgerFile(file);
                  }}
                />
              </div>

              {ledgerPreview && (
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="mb-2 text-sm font-medium text-slate-700">Image Preview</p>
                  <img
                    src={ledgerPreview}
                    alt="Ledger preview"
                    className="max-h-72 w-full rounded-lg object-contain"
                  />
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => void handleExtractLedgerData()}
                  disabled={!ledgerImageBase64 || isExtracting}
                  className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isExtracting ? "Extracting..." : "Extract Data"}
                </button>

                {ledgerError && <p className="text-sm font-medium text-red-600">{ledgerError}</p>}
              </div>

              {ledgerStep === 3 && ocrItems.length > 0 && (
                <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-700">Review Extracted Items</p>
                    <button
                      type="button"
                      onClick={() =>
                        setOcrItems((prev) => prev.map((item) => ({ ...item, checked: true })))
                      }
                      className="text-xs font-medium text-indigo-700"
                    >
                      Select all
                    </button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">
                            Add
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">
                            Product Name
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">
                            Quantity
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">
                            Unit
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">
                            Price
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {ocrItems.map((item) => (
                          <tr key={item.id}>
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                checked={item.checked}
                                onChange={(e) =>
                                  setOcrItems((prev) =>
                                    prev.map((row) =>
                                      row.id === item.id
                                        ? { ...row, checked: e.target.checked }
                                        : row
                                    )
                                  )
                                }
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                value={item.name}
                                onChange={(e) =>
                                  setOcrItems((prev) =>
                                    prev.map((row) =>
                                      row.id === item.id ? { ...row, name: e.target.value } : row
                                    )
                                  )
                                }
                                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                min="0"
                                value={item.qty}
                                onChange={(e) =>
                                  setOcrItems((prev) =>
                                    prev.map((row) =>
                                      row.id === item.id ? { ...row, qty: e.target.value } : row
                                    )
                                  )
                                }
                                className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                value={item.unit}
                                onChange={(e) =>
                                  setOcrItems((prev) =>
                                    prev.map((row) =>
                                      row.id === item.id ? { ...row, unit: e.target.value } : row
                                    )
                                  )
                                }
                                className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.price}
                                onChange={(e) =>
                                  setOcrItems((prev) =>
                                    prev.map((row) =>
                                      row.id === item.id ? { ...row, price: e.target.value } : row
                                    )
                                  )
                                }
                                className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => void handleAddExtractedItems()}
                      disabled={isAddingFromLedger}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isAddingFromLedger ? "Adding..." : "Add to Inventory"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed right-4 top-20 z-[60]">
          <div
            className={`rounded-lg px-4 py-2 text-sm font-medium shadow-lg ${
              toast.type === "success"
                ? "bg-emerald-600 text-white"
                : "bg-red-600 text-white"
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}
    </div>
  );
}
