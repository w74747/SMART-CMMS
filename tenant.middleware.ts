// =============================================================================
// Smart CMMS — Prisma Schema
// Database: PostgreSQL (Supabase)
// Multi-Tenancy Strategy: Schema-per-Tenant
// Version: 1.0.0 — MVP Baseline
// =============================================================================
// NOTE ON MULTI-TENANCY:
//   This schema represents the TEMPLATE for each tenant's isolated schema.
//   The "public" schema holds only: tenants, super_admins, tenant_migrations.
//   Each tenant gets their own schema (e.g., "tenant_abc123") containing ALL
//   tables below (except tenants/super_admins which live in "public").
//   The TenantMiddleware sets the search_path dynamically per request.
// =============================================================================

generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["multiSchema", "postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  directUrl  = env("DIRECT_URL")
  schemas    = ["public", "tenant_template"]
}

// =============================================================================
// PUBLIC SCHEMA — Platform-level tables (not tenant-specific)
// =============================================================================

/// Platform-level tenant registry — lives in the public schema only
model Tenant {
  id              String           @id @default(uuid()) @db.Uuid
  /// Unique slug used as the PostgreSQL schema name: e.g. "tenant_abc123"
  schemaName      String           @unique @map("schema_name") @db.VarChar(63)
  companyName     String           @map("company_name") @db.VarChar(255)
  companyNameAr   String?          @map("company_name_ar") @db.VarChar(255)
  industry        IndustryType
  logoUrl         String?          @map("logo_url") @db.VarChar(500)
  primaryColor    String?          @map("primary_color") @db.VarChar(7)
  subscriptionTier SubscriptionTier @default(STARTER) @map("subscription_tier")
  subscriptionStatus SubscriptionStatus @default(TRIAL) @map("subscription_status")
  trialEndsAt     DateTime?        @map("trial_ends_at") @db.Timestamptz
  maxUsers        Int              @default(20) @map("max_users")
  maxAssets       Int              @default(500) @map("max_assets")
  contactEmail    String           @map("contact_email") @db.VarChar(255)
  contactPhone    String?          @map("contact_phone") @db.VarChar(50)
  country         String           @default("SA") @db.VarChar(2)
  timezone        String           @default("Asia/Riyadh") @db.VarChar(50)
  locale          String           @default("ar") @db.VarChar(10)
  isActive        Boolean          @default(true) @map("is_active")
  onboardingStep  Int              @default(1) @map("onboarding_step")
  onboardingCompleted Boolean      @default(false) @map("onboarding_completed")
  metadata        Json?            @db.JsonB
  createdAt       DateTime         @default(now()) @map("created_at") @db.Timestamptz
  updatedAt       DateTime         @updatedAt @map("updated_at") @db.Timestamptz
  deletedAt       DateTime?        @map("deleted_at") @db.Timestamptz

  @@index([schemaName])
  @@index([subscriptionStatus])
  @@index([isActive])
  @@map("tenants")
  @@schema("public")
}

// =============================================================================
// TENANT SCHEMA TEMPLATE — All tables below are replicated per tenant
// Using "tenant_template" as the Prisma schema reference.
// In production, the TenantMiddleware switches search_path to the tenant schema.
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// USERS & AUTHENTICATION
// ─────────────────────────────────────────────────────────────────────────────

/// System user within a tenant — maps to a physical employee
model User {
  id                String          @id @default(uuid()) @db.Uuid
  employeeId        String?         @unique @map("employee_id") @db.VarChar(50)
  email             String          @unique @db.VarChar(255)
  passwordHash      String          @map("password_hash") @db.VarChar(255)
  firstName         String          @map("first_name") @db.VarChar(100)
  lastName          String          @map("last_name") @db.VarChar(100)
  firstNameAr       String?         @map("first_name_ar") @db.VarChar(100)
  lastNameAr        String?         @map("last_name_ar") @db.VarChar(100)
  phone             String?         @db.VarChar(30)
  avatarUrl         String?         @map("avatar_url") @db.VarChar(500)
  role              UserRole        @default(TECHNICIAN)
  isActive          Boolean         @default(true) @map("is_active")
  isEmailVerified   Boolean         @default(false) @map("is_email_verified")
  emailVerifiedAt   DateTime?       @map("email_verified_at") @db.Timestamptz
  lastLoginAt       DateTime?       @map("last_login_at") @db.Timestamptz
  lastLoginIp       String?         @map("last_login_ip") @db.VarChar(45)
  failedLoginCount  Int             @default(0) @map("failed_login_count")
  lockedUntil       DateTime?       @map("locked_until") @db.Timestamptz
  passwordChangedAt DateTime?       @map("password_changed_at") @db.Timestamptz
  fcmToken          String?         @map("fcm_token") @db.VarChar(500)
  preferredLanguage String          @default("ar") @map("preferred_language") @db.VarChar(10)
  timezone          String          @default("Asia/Riyadh") @db.VarChar(50)
  notificationPrefs Json            @default("{}") @map("notification_prefs") @db.JsonB
  metadata          Json?           @db.JsonB
  createdAt         DateTime        @default(now()) @map("created_at") @db.Timestamptz
  updatedAt         DateTime        @updatedAt @map("updated_at") @db.Timestamptz
  deletedAt         DateTime?       @map("deleted_at") @db.Timestamptz

  // Relations
  department            Department?       @relation(fields: [departmentId], references: [id])
  departmentId          String?           @map("department_id") @db.Uuid
  managedDepartments    Department[]      @relation("DepartmentManager")
  supervisedDepartments Department[]      @relation("DepartmentSupervisors")
  createdWorkOrders     WorkOrder[]       @relation("WorkOrderCreator")
  assignedWorkOrders    WorkOrder[]       @relation("WorkOrderAssignee")
  approvedWorkOrders    WorkOrder[]       @relation("WorkOrderApprover")
  workLogs              WorkLog[]
  meterReadings         MeterReading[]
  auditLogs             AuditLog[]
  refreshTokens         RefreshToken[]
  notifications         Notification[]
  inventoryTransactions InventoryTransaction[]

  @@index([email])
  @@index([role])
  @@index([isActive])
  @@index([departmentId])
  @@map("users")
  @@schema("tenant_template")
}

/// JWT Refresh Token store — one row per active device session
model RefreshToken {
  id          String    @id @default(uuid()) @db.Uuid
  tokenHash   String    @unique @map("token_hash") @db.VarChar(255)
  userId      String    @map("user_id") @db.Uuid
  deviceInfo  Json?     @map("device_info") @db.JsonB
  ipAddress   String?   @map("ip_address") @db.VarChar(45)
  userAgent   String?   @map("user_agent") @db.VarChar(500)
  expiresAt   DateTime  @map("expires_at") @db.Timestamptz
  revokedAt   DateTime? @map("revoked_at") @db.Timestamptz
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz

  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([expiresAt])
  @@map("refresh_tokens")
  @@schema("tenant_template")
}

// ─────────────────────────────────────────────────────────────────────────────
// ORGANIZATIONAL STRUCTURE
// ─────────────────────────────────────────────────────────────────────────────

/// Maintenance department (Mechanical, Electrical, Instrumentation, etc.)
model Department {
  id            String       @id @default(uuid()) @db.Uuid
  name          String       @db.VarChar(150)
  nameAr        String?      @map("name_ar") @db.VarChar(150)
  code          String       @unique @db.VarChar(20)
  type          DepartmentType
  description   String?      @db.Text
  color         String?      @db.VarChar(7)
  isActive      Boolean      @default(true) @map("is_active")
  sortOrder     Int          @default(0) @map("sort_order")
  createdAt     DateTime     @default(now()) @map("created_at") @db.Timestamptz
  updatedAt     DateTime     @updatedAt @map("updated_at") @db.Timestamptz

  // Relations
  manager         User?        @relation("DepartmentManager", fields: [managerId], references: [id])
  managerId       String?      @map("manager_id") @db.Uuid
  supervisors     User[]       @relation("DepartmentSupervisors")
  members         User[]
  workOrders      WorkOrder[]
  pmPlans         PmPlan[]

  @@index([code])
  @@index([isActive])
  @@map("departments")
  @@schema("tenant_template")
}

/// Physical site or branch of the industrial facility
model Site {
  id          String    @id @default(uuid()) @db.Uuid
  name        String    @db.VarChar(150)
  nameAr      String?   @map("name_ar") @db.VarChar(150)
  code        String    @unique @db.VarChar(20)
  address     String?   @db.Text
  city        String?   @db.VarChar(100)
  country     String    @default("SA") @db.VarChar(2)
  latitude    Decimal?  @db.Decimal(10, 8)
  longitude   Decimal?  @db.Decimal(11, 8)
  isActive    Boolean   @default(true) @map("is_active")
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt   DateTime  @updatedAt @map("updated_at") @db.Timestamptz

  // Relations
  locations   Location[]
  assets      Asset[]

  @@index([code])
  @@map("sites")
  @@schema("tenant_template")
}

/// Specific physical location within a site (Building, Floor, Zone, Room)
model Location {
  id          String    @id @default(uuid()) @db.Uuid
  name        String    @db.VarChar(150)
  nameAr      String?   @map("name_ar") @db.VarChar(150)
  code        String    @db.VarChar(30)
  path        String?   @db.VarChar(500)  // Materialized path: "Site/Building/Floor/Zone"
  level       Int       @default(0)        // 0=site, 1=building, 2=floor, 3=zone, 4=room
  isActive    Boolean   @default(true) @map("is_active")
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz

  // Relations
  site        Site      @relation(fields: [siteId], references: [id])
  siteId      String    @map("site_id") @db.Uuid
  parent      Location? @relation("LocationHierarchy", fields: [parentId], references: [id])
  parentId    String?   @map("parent_id") @db.Uuid
  children    Location[] @relation("LocationHierarchy")
  assets      Asset[]

  @@unique([siteId, code])
  @@index([siteId])
  @@index([parentId])
  @@map("locations")
  @@schema("tenant_template")
}

// ─────────────────────────────────────────────────────────────────────────────
// ASSET MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/// Core asset / equipment record
model Asset {
  id                  String        @id @default(uuid()) @db.Uuid
  assetNumber         String        @unique @map("asset_number") @db.VarChar(50)
  serialNumber        String?       @map("serial_number") @db.VarChar(100)
  name                String        @db.VarChar(255)
  nameAr              String?       @map("name_ar") @db.VarChar(255)
  description         String?       @db.Text
  assetType           AssetType
  category            String?       @db.VarChar(100)
  make                String?       @db.VarChar(100)   // Manufacturer
  model               String?       @db.VarChar(100)
  year                Int?
  purchaseDate        DateTime?     @map("purchase_date") @db.Date
  purchasePrice       Decimal?      @map("purchase_price") @db.Decimal(15, 2)
  currency            String        @default("SAR") @db.VarChar(3)
  warrantyExpiresAt   DateTime?     @map("warranty_expires_at") @db.Date
  expectedLifeYears   Int?          @map("expected_life_years")
  operationalStatus   OperationalStatus @default(OPERATIONAL) @map("operational_status")
  criticalityLevel    CriticalityLevel  @default(MEDIUM) @map("criticality_level")
  qrCode              String        @unique @map("qr_code") @db.VarChar(255)
  qrCodeUrl           String?       @map("qr_code_url") @db.VarChar(500)
  thumbnailUrl        String?       @map("thumbnail_url") @db.VarChar(500)
  isActive            Boolean       @default(true) @map("is_active")
  lastMaintenanceAt   DateTime?     @map("last_maintenance_at") @db.Timestamptz
  nextMaintenanceAt   DateTime?     @map("next_maintenance_at") @db.Timestamptz
  totalMaintenanceCost Decimal      @default(0) @map("total_maintenance_cost") @db.Decimal(15, 2)
  totalDowntimeHours  Decimal       @default(0) @map("total_downtime_hours") @db.Decimal(10, 2)
  runningHours        Decimal       @default(0) @map("running_hours") @db.Decimal(12, 2)
  metadata            Json?         @db.JsonB
  createdAt           DateTime      @default(now()) @map("created_at") @db.Timestamptz
  updatedAt           DateTime      @updatedAt @map("updated_at") @db.Timestamptz
  deletedAt           DateTime?     @map("deleted_at") @db.Timestamptz

  // Relations
  site              Site?           @relation(fields: [siteId], references: [id])
  siteId            String?         @map("site_id") @db.Uuid
  location          Location?       @relation(fields: [locationId], references: [id])
  locationId        String?         @map("location_id") @db.Uuid
  parent            Asset?          @relation("AssetHierarchy", fields: [parentId], references: [id])
  parentId          String?         @map("parent_id") @db.Uuid
  children          Asset[]         @relation("AssetHierarchy")
  documents         AssetDocument[]
  meterReadingTypes MeterReadingType[]
  meterReadings     MeterReading[]
  workOrders        WorkOrder[]
  pmPlans           PmPlan[]
  equipmentPatterns EquipmentPattern[]

  @@index([assetNumber])
  @@index([qrCode])
  @@index([operationalStatus])
  @@index([siteId])
  @@index([locationId])
  @@index([parentId])
  @@index([criticalityLevel])
  @@index([isActive])
  @@map("assets")
  @@schema("tenant_template")
}

/// File/document attached to an asset (manuals, drawings, certificates, photos)
model AssetDocument {
  id            String        @id @default(uuid()) @db.Uuid
  assetId       String        @map("asset_id") @db.Uuid
  title         String        @db.VarChar(255)
  titleAr       String?       @map("title_ar") @db.VarChar(255)
  documentType  DocumentType  @map("document_type")
  fileUrl       String        @map("file_url") @db.VarChar(500)
  storagePath   String        @map("storage_path") @db.VarChar(500) // Supabase Storage path
  fileSize      Int?          @map("file_size")  // bytes
  mimeType      String?       @map("mime_type") @db.VarChar(100)
  version       String?       @db.VarChar(20)
  uploadedBy    String        @map("uploaded_by") @db.Uuid
  isActive      Boolean       @default(true) @map("is_active")
  createdAt     DateTime      @default(now()) @map("created_at") @db.Timestamptz

  asset         Asset         @relation(fields: [assetId], references: [id], onDelete: Cascade)

  @@index([assetId])
  @@index([documentType])
  @@map("asset_documents")
  @@schema("tenant_template")
}

// ─────────────────────────────────────────────────────────────────────────────
// METER READINGS
// ─────────────────────────────────────────────────────────────────────────────

/// Definition of a measurable parameter for an asset (e.g., "Bearing Temperature")
model MeterReadingType {
  id              String          @id @default(uuid()) @db.Uuid
  assetId         String          @map("asset_id") @db.Uuid
  name            String          @db.VarChar(150)
  nameAr          String?         @map("name_ar") @db.VarChar(150)
  unit            String?         @db.VarChar(30)     // °C, bar, rpm, hours, etc.
  readingKind     ReadingKind     @map("reading_kind")
  frequency       ReadingFrequency
  /// Allowed options for QUALITATIVE type — JSON array: ["Normal","Low","High"]
  options         Json?           @db.JsonB
  minThreshold    Decimal?        @map("min_threshold") @db.Decimal(15, 4)
  maxThreshold    Decimal?        @map("max_threshold") @db.Decimal(15, 4)
  /// For QUALITATIVE: values that trigger alert — JSON array: ["Low", "Empty"]
  alertValues     Json?           @map("alert_values") @db.JsonB
  isActive        Boolean         @default(true) @map("is_active")
  sortOrder       Int             @default(0) @map("sort_order")
  createdAt       DateTime        @default(now()) @map("created_at") @db.Timestamptz
  updatedAt       DateTime        @updatedAt @map("updated_at") @db.Timestamptz

  asset           Asset           @relation(fields: [assetId], references: [id], onDelete: Cascade)
  readings        MeterReading[]

  @@index([assetId])
  @@map("meter_reading_types")
  @@schema("tenant_template")
}

/// Actual reading entry submitted by a technician
model MeterReading {
  id                  String          @id @default(uuid()) @db.Uuid
  assetId             String          @map("asset_id") @db.Uuid
  readingTypeId       String          @map("reading_type_id") @db.Uuid
  numericValue        Decimal?        @map("numeric_value") @db.Decimal(15, 4)
  qualitativeValue    String?         @map("qualitative_value") @db.VarChar(100)
  isAnomaly           Boolean         @default(false) @map("is_anomaly")
  anomalyDeviation    Decimal?        @map("anomaly_deviation") @db.Decimal(15, 4)
  notes               String?         @db.Text
  /// Supabase Storage path for optional photo evidence
  photoUrl            String?         @map("photo_url") @db.VarChar(500)
  recordedAt          DateTime        @map("recorded_at") @db.Timestamptz
  recordedById        String          @map("recorded_by_id") @db.Uuid
  /// UUID of auto-generated WO if threshold was breached
  triggeredWorkOrderId String?        @map("triggered_work_order_id") @db.Uuid
  /// Was this reading submitted while offline?
  submittedOffline    Boolean         @default(false) @map("submitted_offline")
  offlineQueuedAt     DateTime?       @map("offline_queued_at") @db.Timestamptz
  createdAt           DateTime        @default(now()) @map("created_at") @db.Timestamptz

  asset               Asset           @relation(fields: [assetId], references: [id])
  readingType         MeterReadingType @relation(fields: [readingTypeId], references: [id])
  recordedBy          User            @relation(fields: [recordedById], references: [id])
  triggeredWorkOrder  WorkOrder?      @relation("TriggeredByReading", fields: [triggeredWorkOrderId], references: [id])

  @@index([assetId])
  @@index([readingTypeId])
  @@index([recordedAt])
  @@index([isAnomaly])
  @@map("meter_readings")
  @@schema("tenant_template")
}

// ─────────────────────────────────────────────────────────────────────────────
// PREVENTIVE MAINTENANCE PLANS
// ─────────────────────────────────────────────────────────────────────────────

/// PM Plan template — defines the schedule and tasks for recurring maintenance
model PmPlan {
  id                    String          @id @default(uuid()) @db.Uuid
  title                 String          @db.VarChar(255)
  titleAr               String?         @map("title_ar") @db.VarChar(255)
  description           String?         @db.Text
  assetId               String          @map("asset_id") @db.Uuid
  departmentId          String?         @map("department_id") @db.Uuid
  defaultAssigneeId     String?         @map("default_assignee_id") @db.Uuid
  triggerType           PmTriggerType   @map("trigger_type")
  /// Calendar-based: 1, 7, 14, 30, 90, 180, 365 days
  intervalDays          Int?            @map("interval_days")
  /// Day of week for WEEKLY (0=Sunday...6=Saturday)
  dayOfWeek             Int?            @map("day_of_week")
  /// Day of month for MONTHLY (1-28)
  dayOfMonth            Int?            @map("day_of_month")
  /// Month of year for YEARLY (1-12)
  monthOfYear           Int?            @map("month_of_year")
  /// Preferred hour for WO auto-generation (0-23)
  preferredHour         Int             @default(6) @map("preferred_hour")
  estimatedDurationMin  Int?            @map("estimated_duration_min")
  priority              WoPriority      @default(MEDIUM)
  checklistItems        Json            @default("[]") @map("checklist_items") @db.JsonB
  requiredMaterials     Json            @default("[]") @map("required_materials") @db.JsonB
  safetyInstructions    String?         @map("safety_instructions") @db.Text
  isActive              Boolean         @default(true) @map("is_active")
  lastGeneratedAt       DateTime?       @map("last_generated_at") @db.Timestamptz
  nextDueAt             DateTime?       @map("next_due_at") @db.Timestamptz
  totalGenerated        Int             @default(0) @map("total_generated")
  createdAt             DateTime        @default(now()) @map("created_at") @db.Timestamptz
  updatedAt             DateTime        @updatedAt @map("updated_at") @db.Timestamptz
  createdById           String          @map("created_by_id") @db.Uuid

  asset                 Asset           @relation(fields: [assetId], references: [id])
  department            Department?     @relation(fields: [departmentId], references: [id])
  workOrders            WorkOrder[]

  @@index([assetId])
  @@index([nextDueAt])
  @@index([isActive])
  @@map("pm_plans")
  @@schema("tenant_template")
}

// ─────────────────────────────────────────────────────────────────────────────
// WORK ORDERS
// ─────────────────────────────────────────────────────────────────────────────

/// Core Work Order — corrective, preventive, emergency, or inspection
model WorkOrder {
  id                    String        @id @default(uuid()) @db.Uuid
  woNumber              String        @unique @map("wo_number") @db.VarChar(30)
  title                 String        @db.VarChar(255)
  titleAr               String?       @map("title_ar") @db.VarChar(255)
  description           String?       @db.Text
  assetId               String        @map("asset_id") @db.Uuid
  departmentId          String?       @map("department_id") @db.Uuid
  pmPlanId              String?       @map("pm_plan_id") @db.Uuid
  /// NULL if created manually
  triggeringReadingId   String?       @map("triggering_reading_id") @db.Uuid
  status                WoStatus      @default(PENDING)
  woType                WoType        @map("wo_type")
  priority              WoPriority    @default(MEDIUM)
  createdById           String        @map("created_by_id") @db.Uuid
  assigneeId            String?       @map("assignee_id") @db.Uuid
  approvedById          String?       @map("approved_by_id") @db.Uuid
  /// Timestamps for SLA and KPI calculation
  scheduledStartAt      DateTime?     @map("scheduled_start_at") @db.Timestamptz
  scheduledEndAt        DateTime?     @map("scheduled_end_at") @db.Timestamptz
  actualStartAt         DateTime?     @map("actual_start_at") @db.Timestamptz
  actualEndAt           DateTime?     @map("actual_end_at") @db.Timestamptz
  approvedAt            DateTime?     @map("approved_at") @db.Timestamptz
  cancelledAt           DateTime?     @map("cancelled_at") @db.Timestamptz
  dueAt                 DateTime?     @map("due_at") @db.Timestamptz
  /// Calculated field in minutes: actualEndAt - actualStartAt
  actualDurationMin     Int?          @map("actual_duration_min")
  estimatedDurationMin  Int?          @map("estimated_duration_min")
  /// Downtime in minutes that this WO resolved
  downtimeMin           Int?          @map("downtime_min")
  completionNotes       String?       @map("completion_notes") @db.Text
  rejectionReason       String?       @map("rejection_reason") @db.Text
  cancellationReason    String?       @map("cancellation_reason") @db.Text
  delayReason           DelayReason?  @map("delay_reason")
  delayReasonNotes      String?       @map("delay_reason_notes") @db.Text
  checklistItems        Json          @default("[]") @map("checklist_items") @db.JsonB
  safetyChecklist       Json          @default("[]") @map("safety_checklist") @db.JsonB
  totalMaterialCost     Decimal       @default(0) @map("total_material_cost") @db.Decimal(15, 2)
  totalLaborCost        Decimal       @default(0) @map("total_labor_cost") @db.Decimal(15, 2)
  /// Was this WO created/updated while mobile device was offline?
  createdOffline        Boolean       @default(false) @map("created_offline")
  offlineSyncedAt       DateTime?     @map("offline_synced_at") @db.Timestamptz
  /// UUID of parent WO if this is a child corrective from a PM inspection
  parentWorkOrderId     String?       @map("parent_work_order_id") @db.Uuid
  metadata              Json?         @db.JsonB
  createdAt             DateTime      @default(now()) @map("created_at") @db.Timestamptz
  updatedAt             DateTime      @updatedAt @map("updated_at") @db.Timestamptz

  // Relations
  asset                 Asset         @relation(fields: [assetId], references: [id])
  department            Department?   @relation(fields: [departmentId], references: [id])
  pmPlan                PmPlan?       @relation(fields: [pmPlanId], references: [id])
  createdBy             User          @relation("WorkOrderCreator", fields: [createdById], references: [id])
  assignee              User?         @relation("WorkOrderAssignee", fields: [assigneeId], references: [id])
  approvedBy            User?         @relation("WorkOrderApprover", fields: [approvedById], references: [id])
  parentWorkOrder       WorkOrder?    @relation("WoHierarchy", fields: [parentWorkOrderId], references: [id])
  childWorkOrders       WorkOrder[]   @relation("WoHierarchy")
  triggeringReadings    MeterReading[] @relation("TriggeredByReading")
  photos                WorkOrderPhoto[]
  workItems             WorkItem[]
  workLogs              WorkLog[]
  inventoryTransactions InventoryTransaction[]

  @@index([woNumber])
  @@index([status])
  @@index([assetId])
  @@index([assigneeId])
  @@index([createdById])
  @@index([dueAt])
  @@index([woType])
  @@index([priority])
  @@index([pmPlanId])
  @@index([createdAt])
  @@map("work_orders")
  @@schema("tenant_template")
}

/// Photo evidence attached to a Work Order (before/during/after)
model WorkOrderPhoto {
  id            String      @id @default(uuid()) @db.Uuid
  workOrderId   String      @map("work_order_id") @db.Uuid
  photoStage    PhotoStage  @map("photo_stage")
  fileUrl       String      @map("file_url") @db.VarChar(500)
  storagePath   String      @map("storage_path") @db.VarChar(500)
  thumbnailUrl  String?     @map("thumbnail_url") @db.VarChar(500)
  caption       String?     @db.VarChar(500)
  fileSize      Int?        @map("file_size")
  uploadedById  String      @map("uploaded_by_id") @db.Uuid
  uploadedAt    DateTime    @default(now()) @map("uploaded_at") @db.Timestamptz
  /// Was photo queued offline and uploaded later?
  uploadedOffline Boolean   @default(false) @map("uploaded_offline")

  workOrder     WorkOrder   @relation(fields: [workOrderId], references: [id], onDelete: Cascade)

  @@index([workOrderId])
  @@index([photoStage])
  @@map("work_order_photos")
  @@schema("tenant_template")
}

/// Time-log entries — tracks who worked how long on a WO
model WorkLog {
  id            String    @id @default(uuid()) @db.Uuid
  workOrderId   String    @map("work_order_id") @db.Uuid
  userId        String    @map("user_id") @db.Uuid
  startedAt     DateTime  @map("started_at") @db.Timestamptz
  endedAt       DateTime? @map("ended_at") @db.Timestamptz
  durationMin   Int?      @map("duration_min")
  notes         String?   @db.Text
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz

  workOrder     WorkOrder @relation(fields: [workOrderId], references: [id], onDelete: Cascade)
  user          User      @relation(fields: [userId], references: [id])

  @@index([workOrderId])
  @@index([userId])
  @@index([startedAt])
  @@map("work_logs")
  @@schema("tenant_template")
}

/// Checklist sub-task within a Work Order (derived from PM Plan or ad-hoc)
model WorkItem {
  id            String        @id @default(uuid()) @db.Uuid
  workOrderId   String        @map("work_order_id") @db.Uuid
  title         String        @db.VarChar(255)
  titleAr       String?       @map("title_ar") @db.VarChar(255)
  sortOrder     Int           @default(0) @map("sort_order")
  status        WorkItemStatus @default(PENDING)
  completedById String?       @map("completed_by_id") @db.Uuid
  completedAt   DateTime?     @map("completed_at") @db.Timestamptz
  notes         String?       @db.Text
  photoUrl      String?       @map("photo_url") @db.VarChar(500)
  createdAt     DateTime      @default(now()) @map("created_at") @db.Timestamptz

  workOrder     WorkOrder     @relation(fields: [workOrderId], references: [id], onDelete: Cascade)

  @@index([workOrderId])
  @@map("work_items")
  @@schema("tenant_template")
}

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY
// ─────────────────────────────────────────────────────────────────────────────

/// Spare part / consumable / material in the warehouse
model InventoryItem {
  id              String    @id @default(uuid()) @db.Uuid
  partNumber      String    @unique @map("part_number") @db.VarChar(100)
  barcode         String?   @unique @db.VarChar(100)
  name            String    @db.VarChar(255)
  nameAr          String?   @map("name_ar") @db.VarChar(255)
  description     String?   @db.Text
  category        String?   @db.VarChar(100)
  unit            String    @db.VarChar(30)    // Each, Liter, Meter, KG, Box
  unitCost        Decimal   @default(0) @map("unit_cost") @db.Decimal(15, 2)
  currency        String    @default("SAR") @db.VarChar(3)
  currentQty      Decimal   @default(0) @map("current_qty") @db.Decimal(12, 3)
  reservedQty     Decimal   @default(0) @map("reserved_qty") @db.Decimal(12, 3)
  safetyStock     Decimal   @default(0) @map("safety_stock") @db.Decimal(12, 3)
  reorderQty      Decimal   @default(0) @map("reorder_qty") @db.Decimal(12, 3)
  maxStock        Decimal?  @map("max_stock") @db.Decimal(12, 3)
  warehouseLocation String? @map("warehouse_location") @db.VarChar(100) // e.g., "A-12-3" (Aisle-Shelf-Bin)
  supplierName    String?   @map("supplier_name") @db.VarChar(255)
  supplierPartNo  String?   @map("supplier_part_no") @db.VarChar(100)
  leadTimeDays    Int?      @map("lead_time_days")
  lastReceivedAt  DateTime? @map("last_received_at") @db.Timestamptz
  lastIssuedAt    DateTime? @map("last_issued_at") @db.Timestamptz
  imageUrl        String?   @map("image_url") @db.VarChar(500)
  isActive        Boolean   @default(true) @map("is_active")
  isBelowSafety   Boolean   @default(false) @map("is_below_safety")
  notes           String?   @db.Text
  metadata        Json?     @db.JsonB
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt       DateTime  @updatedAt @map("updated_at") @db.Timestamptz

  // Relations
  transactions    InventoryTransaction[]

  @@index([partNumber])
  @@index([isBelowSafety])
  @@index([category])
  @@index([isActive])
  @@map("inventory_items")
  @@schema("tenant_template")
}

/// Every stock movement: receipt, issue, adjustment, return
model InventoryTransaction {
  id              String            @id @default(uuid()) @db.Uuid
  itemId          String            @map("item_id") @db.Uuid
  workOrderId     String?           @map("work_order_id") @db.Uuid
  transactionType TransactionType   @map("transaction_type")
  quantity        Decimal           @db.Decimal(12, 3)
  unitCostAtTime  Decimal?          @map("unit_cost_at_time") @db.Decimal(15, 2)
  qtyBefore       Decimal           @map("qty_before") @db.Decimal(12, 3)
  qtyAfter        Decimal           @map("qty_after") @db.Decimal(12, 3)
  reasonCode      String?           @map("reason_code") @db.VarChar(50)
  notes           String?           @db.Text
  referenceNumber String?           @map("reference_number") @db.VarChar(100)
  performedById   String            @map("performed_by_id") @db.Uuid
  /// Issue requests need storekeeper confirmation
  confirmedById   String?           @map("confirmed_by_id") @db.Uuid
  confirmedAt     DateTime?         @map("confirmed_at") @db.Timestamptz
  status          TransactionStatus @default(PENDING)
  createdAt       DateTime          @default(now()) @map("created_at") @db.Timestamptz

  item            InventoryItem     @relation(fields: [itemId], references: [id])
  workOrder       WorkOrder?        @relation(fields: [workOrderId], references: [id])
  performedBy     User              @relation(fields: [performedById], references: [id])

  @@index([itemId])
  @@index([workOrderId])
  @@index([transactionType])
  @@index([status])
  @@index([createdAt])
  @@map("inventory_transactions")
  @@schema("tenant_template")
}

// ─────────────────────────────────────────────────────────────────────────────
// EQUIPMENT PATTERNS — Foundation for future AI/Predictive Maintenance (H3)
// Stores time-series feature snapshots per asset to enable RUL prediction
// ─────────────────────────────────────────────────────────────────────────────

model EquipmentPattern {
  id              String    @id @default(uuid()) @db.Uuid
  assetId         String    @map("asset_id") @db.Uuid
  /// Snapshot of all meter readings at this point in time
  readingsSnapshot Json     @map("readings_snapshot") @db.JsonB
  /// How many WOs in last 30/90/365 days
  woCount30d      Int       @default(0) @map("wo_count_30d")
  woCount90d      Int       @default(0) @map("wo_count_90d")
  woCount365d     Int       @default(0) @map("wo_count_365d")
  /// Average MTTR for this asset (minutes)
  avgMttrMin      Decimal?  @map("avg_mttr_min") @db.Decimal(10, 2)
  /// Cumulative running hours at this snapshot
  runningHours    Decimal   @map("running_hours") @db.Decimal(12, 2)
  /// AI-computed health score 0–100 (null until H3 AI module deployed)
  healthScore     Decimal?  @map("health_score") @db.Decimal(5, 2)
  /// Predicted Remaining Useful Life in days (null until H3)
  rulDays         Int?      @map("rul_days")
  capturedAt      DateTime  @map("captured_at") @db.Timestamptz
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz

  asset           Asset     @relation(fields: [assetId], references: [id], onDelete: Cascade)

  @@index([assetId, capturedAt])
  @@index([capturedAt])
  @@map("equipment_patterns")
  @@schema("tenant_template")
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────────────────────────────────────────

model Notification {
  id              String              @id @default(uuid()) @db.Uuid
  userId          String              @map("user_id") @db.Uuid
  type            NotificationType
  title           String              @db.VarChar(255)
  titleAr         String?             @map("title_ar") @db.VarChar(255)
  body            String              @db.Text
  bodyAr          String?             @map("body_ar") @db.Text
  /// Deep-link reference: { type: "WORK_ORDER", id: "uuid" }
  referenceData   Json?               @map("reference_data") @db.JsonB
  isRead          Boolean             @default(false) @map("is_read")
  readAt          DateTime?           @map("read_at") @db.Timestamptz
  sentViaPush     Boolean             @default(false) @map("sent_via_push")
  sentViaEmail    Boolean             @default(false) @map("sent_via_email")
  pushSentAt      DateTime?           @map("push_sent_at") @db.Timestamptz
  emailSentAt     DateTime?           @map("email_sent_at") @db.Timestamptz
  createdAt       DateTime            @default(now()) @map("created_at") @db.Timestamptz

  user            User                @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, isRead])
  @@index([createdAt])
  @@map("notifications")
  @@schema("tenant_template")
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT LOG — Immutable append-only record of all state changes
// ─────────────────────────────────────────────────────────────────────────────

model AuditLog {
  id            String    @id @default(uuid()) @db.Uuid
  userId        String?   @map("user_id") @db.Uuid
  /// Action performed: CREATE_WORK_ORDER, UPDATE_STATUS, DELETE_ASSET, etc.
  action        String    @db.VarChar(100)
  entityType    String    @map("entity_type") @db.VarChar(100)
  entityId      String    @map("entity_id") @db.Uuid
  oldValues     Json?     @map("old_values") @db.JsonB
  newValues     Json?     @map("new_values") @db.JsonB
  ipAddress     String?   @map("ip_address") @db.VarChar(45)
  userAgent     String?   @map("user_agent") @db.VarChar(500)
  requestId     String?   @map("request_id") @db.VarChar(100)
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz

  user          User?     @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([entityType, entityId])
  @@index([userId])
  @@index([action])
  @@index([createdAt])
  @@map("audit_logs")
  @@schema("tenant_template")
}

// =============================================================================
// ENUMERATIONS
// =============================================================================

enum IndustryType {
  PETROCHEMICAL
  POWER_GENERATION
  MINING
  WATER_TREATMENT
  FOOD_BEVERAGE
  CEMENT
  STEEL
  PHARMACEUTICAL
  GENERAL_MANUFACTURING
  OTHER

  @@schema("public")
}

enum SubscriptionTier {
  STARTER
  PROFESSIONAL
  ENTERPRISE

  @@schema("public")
}

enum SubscriptionStatus {
  TRIAL
  ACTIVE
  PAST_DUE
  SUSPENDED
  CANCELLED

  @@schema("public")
}

enum UserRole {
  SUPER_ADMIN
  COMPANY_ADMIN
  MAINTENANCE_MANAGER
  MAINTENANCE_SUPERVISOR
  TECHNICIAN
  STOREKEEPER
  VIEWER

  @@schema("tenant_template")
}

enum DepartmentType {
  MECHANICAL
  ELECTRICAL
  INSTRUMENTATION
  HVAC
  CIVIL
  UTILITIES
  PRODUCTION_SUPPORT
  SAFETY
  OTHER

  @@schema("tenant_template")
}

enum AssetType {
  ROTATING_EQUIPMENT    // Pumps, Compressors, Fans, Motors
  STATIC_EQUIPMENT      // Vessels, Heat Exchangers, Tanks
  ELECTRICAL_EQUIPMENT  // Transformers, Switchgear, MCCs
  INSTRUMENTATION       // Sensors, Transmitters, Analyzers
  HVAC                  // AHUs, Chillers, FCUs
  CIVIL_STRUCTURAL      // Buildings, Structures, Roads
  VEHICLE               // Forklifts, Cranes, Transport
  IT_TELECOM            // Servers, Network, Communication
  SAFETY_EQUIPMENT      // Fire Systems, Gas Detection
  OTHER

  @@schema("tenant_template")
}

enum OperationalStatus {
  OPERATIONAL
  DEGRADED        // Running but with issues
  UNDER_MAINTENANCE
  OUT_OF_SERVICE
  DECOMMISSIONED
  STANDBY

  @@schema("tenant_template")
}

enum CriticalityLevel {
  CRITICAL        // Plant stops if this fails
  HIGH            // Major production impact
  MEDIUM          // Moderate impact
  LOW             // Minimal impact

  @@schema("tenant_template")
}

enum DocumentType {
  MANUAL
  DRAWING
  CERTIFICATE
  PHOTO
  DATASHEET
  PROCEDURE
  REPORT
  OTHER

  @@schema("tenant_template")
}

enum ReadingKind {
  NUMERIC       // Temperature, Pressure, RPM, Hours
  QUALITATIVE   // Good/Bad, Normal/Low/High, Yes/No

  @@schema("tenant_template")
}

enum ReadingFrequency {
  HOURLY
  PER_SHIFT
  DAILY
  WEEKLY
  MONTHLY
  ON_DEMAND

  @@schema("tenant_template")
}

enum PmTriggerType {
  CALENDAR_DAILY
  CALENDAR_WEEKLY
  CALENDAR_MONTHLY
  CALENDAR_YEARLY
  INTERVAL_DAYS   // Every N days from last execution

  @@schema("tenant_template")
}

enum WoStatus {
  PENDING
  ASSIGNED
  IN_PROGRESS
  ON_HOLD
  COMPLETED
  APPROVED
  CANCELLED

  @@schema("tenant_template")
}

enum WoType {
  PREVENTIVE
  CORRECTIVE
  EMERGENCY
  INSPECTION
  MODIFICATION

  @@schema("tenant_template")
}

enum WoPriority {
  CRITICAL
  HIGH
  MEDIUM
  LOW

  @@schema("tenant_template")
}

enum PhotoStage {
  BEFORE
  DURING
  AFTER

  @@schema("tenant_template")
}

enum WorkItemStatus {
  PENDING
  DONE
  NOT_APPLICABLE
  ISSUE_FOUND

  @@schema("tenant_template")
}

enum DelayReason {
  WAITING_FOR_PARTS
  WAITING_FOR_PERMIT
  WAITING_FOR_SHUTDOWN
  CREW_UNAVAILABLE
  TOOLS_UNAVAILABLE
  TECHNICAL_COMPLEXITY
  SAFETY_CONCERN
  OTHER

  @@schema("tenant_template")
}

enum TransactionType {
  RECEIPT         // Stock received from supplier
  ISSUE           // Issued against a Work Order
  RETURN          // Returned to store from WO
  ADJUSTMENT_IN   // Physical count correction (positive)
  ADJUSTMENT_OUT  // Physical count correction (negative)
  TRANSFER        // Between warehouse locations

  @@schema("tenant_template")
}

enum TransactionStatus {
  PENDING         // Issue request submitted, awaiting storekeeper
  CONFIRMED       // Storekeeper confirmed physical issue
  REJECTED        // Storekeeper rejected (out of stock / wrong part)
  CANCELLED       // Cancelled before processing

  @@schema("tenant_template")
}

enum NotificationType {
  WO_ASSIGNED
  WO_STATUS_CHANGED
  WO_OVERDUE
  WO_APPROVAL_NEEDED
  WO_APPROVED
  WO_REJECTED
  PM_DUE
  PM_OVERDUE
  METER_THRESHOLD_BREACH
  INVENTORY_LOW_STOCK
  INVENTORY_ISSUE_REQUEST
  INVENTORY_CONFIRMED
  SYSTEM_ALERT

  @@schema("tenant_template")
}
