-- Metadata unit opsional; surat lama tetap tidak memiliki unit metadata.
ALTER TABLE "SuratMasuk" ADD COLUMN "bagian_id" TEXT REFERENCES "Bagian"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "SuratMasuk_bagian_id_idx" ON "SuratMasuk"("bagian_id");

CREATE TABLE "NotifikasiPenugasan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "disposisi_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotifikasiPenugasan_disposisi_id_fkey" FOREIGN KEY ("disposisi_id") REFERENCES "Disposisi" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "NotifikasiPenugasan_disposisi_id_key" ON "NotifikasiPenugasan"("disposisi_id");
CREATE INDEX "NotifikasiPenugasan_created_at_idx" ON "NotifikasiPenugasan"("created_at");

CREATE TABLE "NotifikasiDibaca" (
    "user_id" TEXT NOT NULL,
    "notifikasi_id" TEXT NOT NULL,
    PRIMARY KEY ("user_id", "notifikasi_id"),
    CONSTRAINT "NotifikasiDibaca_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NotifikasiDibaca_notifikasi_id_fkey" FOREIGN KEY ("notifikasi_id") REFERENCES "NotifikasiPenugasan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "NotifikasiDibaca_notifikasi_id_idx" ON "NotifikasiDibaca"("notifikasi_id");
