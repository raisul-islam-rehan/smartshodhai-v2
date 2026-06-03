"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  FileSearch,
  Loader2,
  Minus,
  PackageSearch,
  Plus,
  ScanLine,
  Upload,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  PRODUCT_SELECT_FULL_OWNER,
  PRODUCT_SELECT_FULL_STAFF,
  productsSelectQuery,
} from "@/lib/products-query";
import { fetchUserRole } from "@/lib/user-role";
import { validateImageUpload } from "@/lib/upload";
import { sanitizeProductName, sanitizeUnit } from "@/lib/validation";
import type { Product } from "@/types";

type ScanMode = "menu" | "barcodeScan" | "scanLedger" | "productScan";
type StockAction = "add" | "sale";

type OcrItem = {
  id: string;
  name: string;
  qty: string;
  unit: string;
  price: string;
  checked: boolean;
};

export default function ScanPage() {
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
  const lookupProductByBarcodeRef = useRef<(barcode: string) => Promise<void>>(async () => {});
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [mode, setMode] = useState<ScanMode>("menu");
  const [scanError, setScanError] = useState("");
  const [scanInfo, setScanInfo] = useState("");
  const [scannedBarcode, setScannedBarcode] = useState("");
  const [matchedProduct, setMatchedProduct] = useState<Product | null>(null);
  const [stockAction, setStockAction] = useState<StockAction>("add");
  const [qtyInput, setQtyInput] = useState("1");
  const [productScanDelta, setProductScanDelta] = useState(1);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [ledgerPreview, setLedgerPreview] = useState("");
  const [ledgerImageBase64, setLedgerImageBase64] = useState("");
  const [ledgerMimeType, setLedgerMimeType] = useState("image/jpeg");
  const [isExtracting, setIsExtracting] = useState(false);
  const [ledgerError, setLedgerError] = useState("");
  const [ocrItems, setOcrItems] = useState<OcrItem[]>([]);
  const [isAddingFromLedger, setIsAddingFromLedger] = useState(false);

  const scannerContainerId = useMemo(
    () => (mode === "barcodeScan" ? "scan-barcode-reader" : "scan-product-reader"),
    [mode]
  );

  useEffect(() => {
    if (mode !== "barcodeScan" && mode !== "productScan") {
      void stopScanner();
      return;
    }

    let cancelled = false;
    const successMessage =
      mode === "barcodeScan"
        ? "Scan a product barcode to add stock or record a sale."
        : "Scan a product barcode to adjust stock instantly.";

    async function startScanner() {
      setScanError("");
      setScanInfo(successMessage);
      setScannedBarcode("");
      setMatchedProduct(null);
      isProcessingScanRef.current = false;

      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
        if (cancelled) return;

        const scanner = new Html5Qrcode(scannerContainerId);
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
          setScanInfo("Barcode captured. Looking up product...");
          void lookupProductByBarcodeRef.current(barcode);
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
              setScanError("No camera found on this device.");
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

        setScanError(
          permissionDenied
            ? "Camera permission denied. Please allow camera access in browser settings and try again."
            : `Unable to start scanner: ${message}`
        );
      }
    }

    void startScanner();

    return () => {
      cancelled = true;
      void stopScanner();
    };
  }, [mode, scannerContainerId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    return () => {
      if (ledgerPreview) URL.revokeObjectURL(ledgerPreview);
    };
  }, [ledgerPreview]);

  async function stopScanner() {
    if (!scannerRef.current) return;
    try {
      await scannerRef.current.stop();
    } catch {
      // Ignore stop errors.
    }
    try {
      await scannerRef.current.clear();
    } catch {
      // Ignore cleanup errors.
    }
    scannerRef.current = null;
    isProcessingScanRef.current = false;
  }

  async function lookupProductByBarcode(barcode: string) {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setScanError("You must be signed in to scan products.");
        isProcessingScanRef.current = false;
        return;
      }

      const role = await fetchUserRole(supabase, user.id);

      const { data, error } = await productsSelectQuery(supabase, user.id, role)
        .eq("barcode", barcode)
        .maybeSingle();

      if (error) {
        setScanError("Could not check this barcode. Try again.");
        isProcessingScanRef.current = false;
        return;
      }

      if (!data) {
        setScanError("No product found for this barcode.");
        setScanInfo("Try scanning again.");
        isProcessingScanRef.current = false;
        return;
      }

      setMatchedProduct(data as Product);
      setQtyInput("1");
      setProductScanDelta(1);
      setScanError("");
      setScanInfo("Product found.");
      await stopScanner();
    } catch {
      setScanError("Could not check this barcode. Try again.");
      isProcessingScanRef.current = false;
    }
  }

  lookupProductByBarcodeRef.current = lookupProductByBarcode;

  function resetToMenu() {
    setMode("menu");
    setScanError("");
    setScanInfo("");
    setScannedBarcode("");
    setMatchedProduct(null);
    setQtyInput("1");
    setStockAction("add");
    setProductScanDelta(1);
  }

  async function handleBarcodeActionSubmit() {
    if (!matchedProduct) return;
    const qty = Number(qtyInput);
    if (!Number.isFinite(qty) || qty <= 0) {
      setToast({ type: "error", text: "Enter a valid quantity." });
      return;
    }
    if (stockAction === "sale" && qty > Number(matchedProduct.stock_qty)) {
      setToast({ type: "error", text: "Sale qty cannot exceed current stock." });
      return;
    }

    setIsSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setIsSaving(false);
      setToast({ type: "error", text: "You must be signed in to update stock." });
      return;
    }

    const nextStock =
      stockAction === "add"
        ? Number(matchedProduct.stock_qty) + qty
        : Number(matchedProduct.stock_qty) - qty;

    const { error: productError } = await supabase
      .from("products")
      .update({ stock_qty: nextStock })
      .eq("owner_id", user.id)
      .eq("id", matchedProduct.id);

    if (productError) {
      setIsSaving(false);
      setToast({ type: "error", text: "Failed to update stock." });
      return;
    }

    if (stockAction === "sale") {
      const { error: saleError } = await supabase.from("sales_log").insert({
        owner_id: user.id,
        product_name: matchedProduct.name,
        qty_sold: qty,
        sale_date: new Date().toISOString(),
      });
      if (saleError) {
        setIsSaving(false);
        setToast({ type: "error", text: "Stock updated but sale log insert failed." });
        setMatchedProduct({ ...matchedProduct, stock_qty: nextStock });
        return;
      }
    }

    setMatchedProduct({ ...matchedProduct, stock_qty: nextStock });
    setIsSaving(false);
    setToast({
      type: "success",
      text: stockAction === "add" ? "Stock added successfully." : "Sale recorded successfully.",
    });
  }

  async function handleProductScanConfirm() {
    if (!matchedProduct) return;
    if (!Number.isFinite(productScanDelta) || productScanDelta <= 0) {
      setToast({ type: "error", text: "Quantity must be at least 1." });
      return;
    }

    const nextStock = Number(matchedProduct.stock_qty) + productScanDelta;
    if (nextStock < 0) {
      setToast({ type: "error", text: "Stock cannot go below zero." });
      return;
    }

    setIsSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setIsSaving(false);
      setToast({ type: "error", text: "You must be signed in to update stock." });
      return;
    }

    const { error } = await supabase
      .from("products")
      .update({ stock_qty: nextStock })
      .eq("owner_id", user.id)
      .eq("id", matchedProduct.id);

    setIsSaving(false);
    if (error) {
      setToast({ type: "error", text: "Could not update stock." });
      return;
    }

    setMatchedProduct({ ...matchedProduct, stock_qty: nextStock });
    setToast({ type: "success", text: "Stock updated instantly." });
  }

  async function fileToBase64(file: File) {
    const reader = new FileReader();
    return await new Promise<string>((resolve, reject) => {
      reader.onload = () => {
        const result = String(reader.result ?? "");
        const commaIndex = result.indexOf(",");
        if (commaIndex === -1) {
          reject(new Error("Invalid image file."));
          return;
        }
        resolve(result.slice(commaIndex + 1));
      };
      reader.onerror = () => reject(new Error("Could not read image."));
      reader.readAsDataURL(file);
    });
  }

  async function onLedgerFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const uploadError = validateImageUpload(file);
    if (uploadError) {
      setLedgerError(uploadError);
      return;
    }

    const validTypes = ["image/jpeg", "image/png", "image/heic", "image/heif"];
    if (!validTypes.includes(file.type)) {
      setLedgerError("Please upload JPG, PNG, or HEIC.");
      return;
    }

    try {
      const base64 = await fileToBase64(file);
      if (ledgerPreview) URL.revokeObjectURL(ledgerPreview);
      setLedgerImageBase64(base64);
      setLedgerMimeType(file.type || "image/jpeg");
      setLedgerPreview(URL.createObjectURL(file));
      setLedgerError("");
      setOcrItems([]);
    } catch {
      setLedgerError("Could not process image.");
    }
  }

  async function extractLedger() {
    if (!ledgerImageBase64) {
      setLedgerError("Upload a khata photo first.");
      return;
    }

    setIsExtracting(true);
    setLedgerError("");
    try {
      const response = await fetch("/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: ledgerImageBase64, mimeType: ledgerMimeType }),
      });
      const json = (await response.json()) as {
        items?: Array<{ name: string; qty: number; unit?: string; price?: number }>;
        error?: string;
        warning?: string;
      };

      if (!response.ok) {
        setLedgerError(json.error || "Image unclear. Try better lighting.");
        setIsExtracting(false);
        return;
      }

      if (json.warning && (!json.items || json.items.length === 0)) {
        setLedgerError(json.warning);
        setIsExtracting(false);
        return;
      }

      if (!json.items || json.items.length === 0) {
        setLedgerError("Image unclear. Try better lighting.");
        setIsExtracting(false);
        return;
      }

      setOcrItems(
        json.items.map((item, index) => ({
          id: `${Date.now()}-${index}`,
          name: item.name ?? "",
          qty: String(item.qty ?? ""),
          unit: item.unit ?? "pcs",
          price: item.price != null ? String(item.price) : "",
          checked: true,
        }))
      );
    } catch {
      setLedgerError("Image unclear. Try better lighting.");
    } finally {
      setIsExtracting(false);
    }
  }

  async function addExtractedToInventory() {
    const selected = ocrItems.filter((item) => item.checked && item.name.trim() && item.qty.trim());
    if (!selected.length) {
      setToast({ type: "error", text: "Select at least one valid item." });
      return;
    }

    setIsAddingFromLedger(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setToast({ type: "error", text: "You must be signed in to add items." });
      setIsAddingFromLedger(false);
      return;
    }

    const role = await fetchUserRole(supabase, user.id);

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

    const { error } =
      role === "owner"
        ? await supabase.from("products").insert(payload).select(PRODUCT_SELECT_FULL_OWNER)
        : await supabase.from("products").insert(payload).select(PRODUCT_SELECT_FULL_STAFF);
    setIsAddingFromLedger(false);

    if (error) {
      setToast({ type: "error", text: "Failed to add scanned items." });
      return;
    }

    setToast({ type: "success", text: `${selected.length} items added to inventory.` });
    setOcrItems([]);
    setLedgerImageBase64("");
    if (ledgerPreview) {
      URL.revokeObjectURL(ledgerPreview);
      setLedgerPreview("");
    }
  }

  return (
    <div className="min-h-[calc(100vh-5.5rem)] rounded-2xl bg-gradient-to-b from-indigo-700 via-indigo-700 to-indigo-800 p-4 text-white sm:p-6">
      <div className="mx-auto w-full max-w-xl">
        <h2 className="text-2xl font-bold tracking-tight">Scan</h2>
        <p className="mt-1 text-sm text-indigo-100">Smart scanner tools for inventory updates</p>

        {mode === "menu" && (
          <div className="mt-6 space-y-4">
            <button
              type="button"
              onClick={() => setMode("barcodeScan")}
              className="w-full rounded-2xl bg-white p-5 text-left text-indigo-900 shadow-lg ring-1 ring-indigo-100 transition hover:bg-indigo-50"
            >
              <div className="mb-3 inline-flex rounded-xl bg-indigo-100 p-3 text-indigo-700">
                <ScanLine className="h-7 w-7" />
              </div>
              <p className="text-lg font-semibold">Barcode Scan</p>
              <p className="mt-1 text-sm text-slate-600">
                Scan barcode, find product, then Add Stock or Record Sale with quantity.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setMode("scanLedger")}
              className="w-full rounded-2xl bg-white p-5 text-left text-indigo-900 shadow-lg ring-1 ring-indigo-100 transition hover:bg-indigo-50"
            >
              <div className="mb-3 inline-flex rounded-xl bg-amber-100 p-3 text-amber-700">
                <FileSearch className="h-7 w-7" />
              </div>
              <p className="text-lg font-semibold">Scan Ledger</p>
              <p className="mt-1 text-sm text-slate-600">
                Upload khata photo, OCR extract rows, then add items to inventory.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setMode("productScan")}
              className="w-full rounded-2xl bg-white p-5 text-left text-indigo-900 shadow-lg ring-1 ring-indigo-100 transition hover:bg-indigo-50"
            >
              <div className="mb-3 inline-flex rounded-xl bg-emerald-100 p-3 text-emerald-700">
                <PackageSearch className="h-7 w-7" />
              </div>
              <p className="text-lg font-semibold">Product Scan</p>
              <p className="mt-1 text-sm text-slate-600">
                Scan product barcode, adjust quantity with +/- selector, then confirm update.
              </p>
            </button>
          </div>
        )}

        {(mode === "barcodeScan" || mode === "productScan") && (
          <div className="mt-6 space-y-4 rounded-2xl bg-white p-4 text-slate-800 shadow-xl">
            <button
              type="button"
              onClick={resetToMenu}
              className="text-xs font-semibold uppercase tracking-wide text-indigo-700"
            >
              Back to Scan Options
            </button>
            <div
              id={scannerContainerId}
              className="min-h-[250px] overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
            />
            {scannedBarcode && (
              <p className="rounded-lg bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700">
                Barcode: <span className="font-bold">{scannedBarcode}</span>
              </p>
            )}
            {scanInfo && <p className="text-sm text-slate-600">{scanInfo}</p>}
            {scanError && <p className="text-sm font-medium text-red-600">{scanError}</p>}

            {matchedProduct && mode === "barcodeScan" && (
              <div className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50 p-4">
                <p className="text-base font-semibold text-indigo-900">{matchedProduct.name}</p>
                <p className="text-sm text-indigo-800">
                  Current Stock: <strong>{matchedProduct.stock_qty}</strong> {matchedProduct.unit}
                </p>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setStockAction("add")}
                    className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                      stockAction === "add"
                        ? "bg-emerald-600 text-white"
                        : "bg-white text-emerald-700 ring-1 ring-emerald-200"
                    }`}
                  >
                    Add Stock
                  </button>
                  <button
                    type="button"
                    onClick={() => setStockAction("sale")}
                    className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                      stockAction === "sale"
                        ? "bg-amber-600 text-white"
                        : "bg-white text-amber-700 ring-1 ring-amber-200"
                    }`}
                  >
                    Record Sale
                  </button>
                </div>

                <input
                  type="number"
                  min="1"
                  value={qtyInput}
                  onChange={(event) => setQtyInput(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                  placeholder="Enter quantity"
                />
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => void handleBarcodeActionSubmit()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Confirm Update
                </button>
              </div>
            )}

            {matchedProduct && mode === "productScan" && (
              <div className="space-y-3 rounded-xl border border-emerald-100 bg-emerald-50 p-4">
                <div className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-xs font-semibold text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Product Found
                </div>
                <p className="text-base font-semibold text-emerald-900">{matchedProduct.name}</p>
                <p className="text-sm text-emerald-800">
                  Current Stock: <strong>{matchedProduct.stock_qty}</strong> {matchedProduct.unit}
                </p>

                <div className="rounded-xl bg-white p-3 ring-1 ring-emerald-100">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Quantity Selector
                  </p>
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setProductScanDelta((prev) => prev - 1)}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-slate-700"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="text-lg font-bold text-slate-800">
                      {productScanDelta > 0 ? `+${productScanDelta}` : productScanDelta}
                    </span>
                    <button
                      type="button"
                      onClick={() => setProductScanDelta((prev) => prev + 1)}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-slate-700"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => void handleProductScanConfirm()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Confirm Stock Update
                </button>
              </div>
            )}
          </div>
        )}

        {mode === "scanLedger" && (
          <div className="mt-6 space-y-4 rounded-2xl bg-white p-4 text-slate-800 shadow-xl">
            <button
              type="button"
              onClick={resetToMenu}
              className="text-xs font-semibold uppercase tracking-wide text-indigo-700"
            >
              Back to Scan Options
            </button>

            <div
              className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mx-auto mb-2 h-6 w-6 text-slate-500" />
              <p className="text-sm font-medium text-slate-700">Upload handwritten khata image</p>
              <p className="mt-1 text-xs text-slate-500">JPG, PNG, HEIC</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.heic,image/jpeg,image/png,image/heic,image/heif"
                className="hidden"
                onChange={(event) => void onLedgerFileChange(event)}
              />
            </div>

            {ledgerPreview && (
              <img
                src={ledgerPreview}
                alt="Ledger preview"
                className="max-h-72 w-full rounded-lg border border-slate-200 object-contain"
              />
            )}

            <button
              type="button"
              disabled={!ledgerImageBase64 || isExtracting}
              onClick={() => void extractLedger()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {isExtracting && <Loader2 className="h-4 w-4 animate-spin" />}
              {isExtracting ? "Extracting..." : "Extract Data"}
            </button>

            {ledgerError && <p className="text-sm font-medium text-red-600">{ledgerError}</p>}

            {ocrItems.length > 0 && (
              <div className="space-y-3 rounded-xl border border-slate-200 p-3">
                <p className="text-sm font-semibold text-slate-700">Review extracted entries</p>
                {ocrItems.map((item) => (
                  <label
                    key={item.id}
                    className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2"
                  >
                    <input
                      type="checkbox"
                      checked={item.checked}
                      onChange={(event) =>
                        setOcrItems((prev) =>
                          prev.map((row) =>
                            row.id === item.id ? { ...row, checked: event.target.checked } : row
                          )
                        )
                      }
                    />
                    <div className="text-sm">
                      <p className="font-medium text-slate-800">{item.name}</p>
                      <p className="text-slate-600">
                        Qty: {item.qty} {item.unit}
                        {item.price ? ` | Price: ${item.price}` : ""}
                      </p>
                    </div>
                  </label>
                ))}
                <button
                  type="button"
                  disabled={isAddingFromLedger}
                  onClick={() => void addExtractedToInventory()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {isAddingFromLedger && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isAddingFromLedger ? "Adding..." : "Add to Inventory"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed right-4 top-20 z-[70]">
          <div
            className={`rounded-lg px-4 py-2 text-sm font-medium shadow-lg ${
              toast.type === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
            }`}
          >
            {toast.text}
          </div>
        </div>
      )}
    </div>
  );
}
