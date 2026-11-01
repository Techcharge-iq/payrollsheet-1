import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), upload: vi.fn(), createSignedUrl: vi.fn() }));
vi.mock("@/integrations/supabase/external-client", () => ({
  db: {
    auth: { getUser: mocks.getUser },
    storage: { from: () => ({ upload: mocks.upload, createSignedUrl: mocks.createSignedUrl }) },
  },
}));
import { uploadTimesheetImage } from "../../utils/visionParser";

describe("private timesheet image uploads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-123" } }, error: null });
    mocks.upload.mockResolvedValue({ error: null });
    mocks.createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://example.test/signed-image" },
      error: null,
    });
  });
  it("uploads into the signed-in user's folder without overwriting and returns a signed link", async () => {
    const file = new File(["image"], "site.jpg", { type: "image/jpeg" });
    const result = await uploadTimesheetImage(file);
    expect(result.storagePath.startsWith("user-123/daily/")).toBe(true);
    expect(mocks.upload).toHaveBeenCalledWith(result.storagePath, file, {
      upsert: false,
      contentType: "image/jpeg",
    });
    expect(mocks.createSignedUrl).toHaveBeenCalledWith(result.storagePath, 3600);
    expect(result.publicUrl).toBe("https://example.test/signed-image");
  });
  it("rejects signed-out uploads before writing any file", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(uploadTimesheetImage(new File(["x"], "site.jpg"))).rejects.toThrow(
      "Sign in again",
    );
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("reports a missing bucket without requesting a broken image link", async () => {
    mocks.upload.mockResolvedValue({ error: { message: "Bucket not found" } });
    const uploadPromise = uploadTimesheetImage(new File(["x"], "site.jpg"));
    await expect(uploadPromise).rejects.toThrow(
      "private timesheet-uploads bucket is not configured",
    );
    await expect(uploadPromise).rejects.toThrow("fix-external-attendance-infrastructure.sql");
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
  });
});
