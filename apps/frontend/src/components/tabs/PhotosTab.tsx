import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Select, Upload, Button, Table, Tag, Typography, Space, Empty, Spin, message } from "antd";
import { hasPermission, Permission, Role } from "@construction-erp/domain";
import { useAuth } from "../../lib/auth";
import { api, ApiError } from "../../lib/api";

/**
 * Вкладка «Фото» карточки объекта — минимальная фотофиксация СК (ТЗ).
 * ХАРДЕНИНГ-ФИКС (эта итерация): раньше эта вкладка была информационной
 * заглушкой (текст-Alert), хотя InspectionPhoto уже существует в Prisma, а
 * backend (InspectionsController.uploadPhoto/listPhotos) реализован в этой
 * же итерации через существующий порт FileStorageProvider. Файл читается
 * на клиенте через FileReader в base64 (см. комментарий в
 * inspections.module.ts — почему не multipart/FileInterceptor) и
 * отправляется обычным JSON POST, как и остальной API в этом проекте.
 *
 * ИНТЕГРИТИ-ФИКС (эта итерация): MockFileStorageProvider теперь реально
 * сохраняет байты на диск (см. mock-bitrix.adapter.ts), и backend отдаёт их
 * через `GET /inspections/photos/:photoId/file`. Раньше эта вкладка
 * показывала только `fileName` — саму фотографию посмотреть было нельзя.
 * Простой `<a href>`/`<img src>` на этот endpoint не сработает: авторизация
 * в этом проекте идёт через заголовки (X-Tenant-Id/X-Bitrix-User-Id в
 * demo-режиме, Authorization: Bearer в bitrix-режиме — см. lib/auth.tsx), а
 * не через cookie, и браузер не добавит их к обычной навигации/тегу img.
 * Поэтому файл запрашивается через `fetch(..., { headers })` вручную (в
 * api.ts нет метода для бинарных ответов — JSON-клиент сюда не подходит),
 * оборачивается в Blob-URL и открывается в новой вкладке. Пустое окно
 * открывается СИНХРОННО в обработчике клика (до await), иначе браузер
 * блокирует `window.open()` как всплывающее окно, потерявшее контекст
 * пользовательского жеста.
 */
interface InspectionRow {
  id: string;
  objectWorkId: string;
  objectWork: { name: string };
  status: string;
}
interface InspectionIssue {
  id: string;
  title: string;
}
interface InspectionPhoto {
  id: string;
  fileName: string;
  fileProvider: "LOCAL" | "BITRIX_DISK";
  externalFileId: string;
  issueId: string | null;
  uploadedBy: string;
  createdAt: string;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // data:<mime>;base64,<...> -> берём только полезную нагрузку
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function PhotosTab({ inspections, role }: { inspections: InspectionRow[]; role: Role }) {
  const { tenantId, headers } = useAuth();
  const qc = useQueryClient();
  const [selectedInspectionId, setSelectedInspectionId] = React.useState<string | undefined>(inspections[0]?.id);
  const [selectedIssueId, setSelectedIssueId] = React.useState<string | undefined>(undefined);
  const [uploading, setUploading] = React.useState(false);
  const [openingPhotoId, setOpeningPhotoId] = React.useState<string | null>(null);

  const canUpload = hasPermission(role, Permission.ISSUE_CREATE);

  React.useEffect(() => {
    if (!selectedInspectionId && inspections.length > 0) setSelectedInspectionId(inspections[0].id);
  }, [inspections, selectedInspectionId]);

  const detailQ = useQuery({
    queryKey: ["inspection-detail", selectedInspectionId],
    queryFn: () => api.get<{ issues: InspectionIssue[] }>(`/inspections/${selectedInspectionId}`, headers),
    enabled: !!selectedInspectionId,
  });

  const photosQ = useQuery({
    queryKey: ["inspection-photos", selectedInspectionId],
    queryFn: () => api.get<InspectionPhoto[]>(`/inspections/${selectedInspectionId}/photos`, headers),
    enabled: !!selectedInspectionId,
  });

  const uploadMut = useMutation({
    mutationFn: (payload: { fileName: string; contentBase64: string; issueId?: string }) =>
      api.post(`/inspections/${selectedInspectionId}/photos`, headers, payload),
    onSuccess: () => {
      message.success("Фото загружено");
      qc.invalidateQueries({ queryKey: ["inspection-photos", selectedInspectionId] });
    },
    onError: (err) => message.error(err instanceof ApiError ? err.message : "Не удалось загрузить фото"),
  });

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const contentBase64 = await readFileAsBase64(file);
      await uploadMut.mutateAsync({ fileName: file.name, contentBase64, issueId: selectedIssueId });
    } finally {
      setUploading(false);
    }
    return false; // не даём antd Upload делать собственный запрос
  }

  /**
   * Открыть содержимое фото в новой вкладке. Пустое окно открывается ДО
   * await fetch — иначе window.open() после асинхронной операции browser
   * может заблокировать как popup, потерявший связь с кликом пользователя.
   */
  async function handleOpenPhoto(photo: InspectionPhoto) {
    const win = window.open("", "_blank", "noopener,noreferrer");
    setOpeningPhotoId(photo.id);
    try {
      const res = await fetch(`/api/inspections/photos/${photo.id}/file`, { headers });
      if (!res.ok) {
        let body: any = null;
        try {
          body = await res.json();
        } catch {
          /* тело может быть пустым */
        }
        throw new ApiError(res.status, body);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (win) {
        win.location.href = url;
      } else {
        message.warning("Браузер заблокировал открытие вкладки — разрешите всплывающие окна для этого сайта");
      }
      // Ревокация с задержкой — даём открывшейся вкладке время реально
      // загрузить содержимое по Blob-URL до его освобождения.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      win?.close();
      message.error(err instanceof ApiError ? err.message : "Не удалось открыть фото");
    } finally {
      setOpeningPhotoId(null);
    }
  }

  if (inspections.length === 0) {
    return <Empty description="У объекта ещё нет проверок строительного контроля — фото прикладываются к конкретной проверке или замечанию" />;
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space wrap>
        <Select
          style={{ width: 320 }}
          placeholder="Проверка (работа)"
          value={selectedInspectionId}
          onChange={(v) => {
            setSelectedInspectionId(v);
            setSelectedIssueId(undefined);
          }}
          options={inspections.map((i) => ({ value: i.id, label: `${i.objectWork?.name ?? "—"} (${i.status})` }))}
        />
        <Select
          style={{ width: 260 }}
          allowClear
          placeholder="Замечание (необязательно)"
          value={selectedIssueId}
          onChange={(v) => setSelectedIssueId(v)}
          options={(detailQ.data?.issues ?? []).map((i) => ({ value: i.id, label: i.title }))}
          disabled={!selectedInspectionId}
        />
        {canUpload && (
          <Upload beforeUpload={handleUpload} showUploadList={false} accept="image/*" disabled={!selectedInspectionId || uploading}>
            <Button loading={uploading} disabled={!selectedInspectionId}>
              Загрузить фото
            </Button>
          </Upload>
        )}
      </Space>

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Хранилище: {tenantId ? "MockFileStorageProvider (demo-режим — без активной установки Bitrix24 для тенанта)" : "—"}. Реальная
        загрузка в Bitrix24.Disk не проверялась на тестовом портале.
      </Typography.Text>

      {photosQ.isLoading ? (
        <Spin />
      ) : (
        <Table<InspectionPhoto>
          size="small"
          rowKey="id"
          dataSource={photosQ.data ?? []}
          pagination={{ pageSize: 10 }}
          locale={{ emptyText: "Фото ещё не загружены" }}
          columns={[
            { title: "Файл", dataIndex: "fileName" },
            { title: "Хранилище", dataIndex: "fileProvider", width: 130, render: (v: string) => <Tag>{v}</Tag> },
            { title: "Замечание", dataIndex: "issueId", width: 100, render: (v: string | null) => (v ? <Tag color="gold">да</Tag> : "—") },
            { title: "Загрузил", dataIndex: "uploadedBy", width: 160 },
            { title: "Когда", dataIndex: "createdAt", width: 150, render: (v: string) => new Date(v).toLocaleString("ru-RU") },
            {
              title: "Просмотр",
              key: "view",
              width: 150,
              render: (_: unknown, photo: InspectionPhoto) => (
                <Button size="small" loading={openingPhotoId === photo.id} onClick={() => handleOpenPhoto(photo)}>
                  Открыть фото
                </Button>
              ),
            },
          ]}
        />
      )}
    </Space>
  );
}
