import test from "node:test";
import assert from "node:assert/strict";
import { PtoPackageValidationService } from "../src/pto";
import { ExecutiveDocumentStatus, ExecutiveDocumentType } from "../src/types";

test("пустой пакет не может быть передан", () => {
  const r = PtoPackageValidationService.validate([], []);
  assert.equal(r.canTransfer, false);
});

test("блокируется без АОСР", () => {
  const r = PtoPackageValidationService.validate(
    [
      {
        workId: "w1",
        workName: "Бетонирование фундамента Ф-1",
        requiresExecutiveDocs: true,
        requiresMaterials: false,
        hasMaterialWithValidDocument: false,
      },
    ],
    [],
  );
  assert.equal(r.canTransfer, false);
  assert.ok(r.reasons[0].includes("АОСР"));
});

test("блокируется, пока АОСР в DRAFT", () => {
  const r = PtoPackageValidationService.validate(
    [
      {
        workId: "w1",
        workName: "Бетонирование фундамента Ф-1",
        requiresExecutiveDocs: true,
        requiresMaterials: false,
        hasMaterialWithValidDocument: false,
      },
    ],
    [{ workId: "w1", type: ExecutiveDocumentType.AOSR, status: ExecutiveDocumentStatus.DRAFT }],
  );
  assert.equal(r.canTransfer, false);
});

test("разрешено с APPROVED АОСР и материалом", () => {
  const r = PtoPackageValidationService.validate(
    [
      {
        workId: "w1",
        workName: "Бетонирование фундамента Ф-1",
        requiresExecutiveDocs: true,
        requiresMaterials: true,
        hasMaterialWithValidDocument: true,
      },
    ],
    [{ workId: "w1", type: ExecutiveDocumentType.AOSR, status: ExecutiveDocumentStatus.APPROVED }],
  );
  assert.equal(r.canTransfer, true);
});

test("блокируется без сертифицированного материала", () => {
  const r = PtoPackageValidationService.validate(
    [
      {
        workId: "w1",
        workName: "Бетонирование фундамента Ф-1",
        requiresExecutiveDocs: false,
        requiresMaterials: true,
        hasMaterialWithValidDocument: false,
      },
    ],
    [],
  );
  assert.equal(r.canTransfer, false);
  assert.ok(r.reasons[0].includes("материал"));
});
