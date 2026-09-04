export type AuditLogInput = {
    userId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown> | null;
};
/**
 * Create a financial/system audit log.
 *
 * Audit logging is intentionally best-effort:
 * a failure to write an audit record should not
 * cause the underlying payment operation to fail.
 */
export declare function createAuditLog(input: AuditLogInput): Promise<void>;
//# sourceMappingURL=audit.d.ts.map