export function assertTenantAccess(context, resource) {
  if (!context?.tenantId || !context?.userId) {
    const error = new Error("Authenticated tenant context required");
    error.code = "FANTAOS_AUTH_REQUIRED";
    error.status = 401;
    throw error;
  }

  if (!resource?.tenant_id || resource.tenant_id !== context.tenantId) {
    const error = new Error("Tenant access denied");
    error.code = "FANTAOS_TENANT_DENIED";
    error.status = 403;
    throw error;
  }

  return true;
}

export function scopeForTenant(context, extra = {}) {
  if (!context?.tenantId) {
    const error = new Error("Tenant scope required");
    error.code = "FANTAOS_TENANT_REQUIRED";
    error.status = 400;
    throw error;
  }

  return {
    tenant_id: context.tenantId,
    ...extra
  };
}
