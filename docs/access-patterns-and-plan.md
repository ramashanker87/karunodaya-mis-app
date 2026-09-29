# Access patterns, data model, and implementation plan

## Source inspection and limits

The request in the conversation is the available requirement text. No four program workbooks or separate requirement document were present in this repository on 28 September 2026. Workbook-specific fields, sheet names, formulas, and migration counts remain unverified. Data-entry and reflection sheets will be imported as source records; dashboard, monthly, centre, and class-wise sheets will be used only to reconcile calculated outputs. Spreadsheet formulas will not be copied into application logic without a documented definition and sample-row check.

Known ambiguities to resolve from the workbooks:

| Topic | Working interpretation | Decision still needed |
| --- | --- | --- |
| Digital workbook dashboard labels referring to LLP | Treat dashboard labels as calculated-view metadata, not proof that source rows belong to LLP. | Compare source sheet columns, formulas, and cross-sheet references; confirm the intended program for each chart. |
| Student `Status` and `Drop-Out Status` | Preserve both raw values during import. `Status` represents enrollment lifecycle; `Drop-Out Status` is a separate reason/flag until source values prove otherwise. | List distinct values and date behavior, then map to canonical enrollment status and dropout reason without losing either source field. |
| Attendance, reach, and enrollment | Attendance is a sum of attendance records; reach is distinct student IDs; enrollment is current student state; activities are distinct event IDs. | Determine which sheets contain student-level attendance versus aggregate counts. Do not infer unique students from aggregate totals. |
| Program year | April 1 through March 31; label `2026–27` for 2026-04-01 through 2027-03-31. | Confirm whether any workbook uses a different fiscal boundary. |
| Names, schools, and centres | Names are display fields; stable generated IDs are identities. | Resolve duplicate names and renamed locations through a reviewed crosswalk. |

## Access-pattern matrix

| Screen/operation | Principal query | Post-query calculation / authorization |
| --- | --- | --- |
| Program dashboard, weekly/monthly/yearly reports | `ProgramOperations` PK `PROGRAM#<programId>`, SK between `EVENT#<from>` and `EVENT#<to>`; paginate. | Restrict to assigned program; exclude soft-deleted rows; derive counts and series from source events. |
| School/centre/village dashboard | `ProgramOperations` GSI `LocationDateIndex`, PK `LOCATION#<locationId>`, SK date range. | Restrict to assigned programs before returning results. |
| Facilitator activity view | `ProgramOperations` GSI `FacilitatorDateIndex`, PK `STAFF#<staffId>`, SK date range. | Enforce own-record rule for facilitators; program managers see assigned program records. |
| Task board | `ProgramOperations` PK `PROGRAM#<programId>`, SK prefix `TASK#`; assignee view uses `AssigneeDueIndex`. | Restrict to assigned programs and task assignee/creator rules. |
| Student registry / current enrollment | `Students` GSI `ProgramEnrollmentIndex`, PK `PROGRAM#<programId>#STATUS#<status>`, SK `LOCATION#<locationId>#STUDENT#<id>`. | Individual details only for authorized users. Aggregate reports use counts. |
| Student profile and dated history | `Students` PK `STUDENT#<id>`, SK `PROFILE`, `ENROLLMENT#<programId>`, and `HISTORY#<date>#<id>`. | Backend checks program membership before reading identifiable fields. |
| Admin approval queue | `IdentityAccess` GSI `ApprovalIndex`, PK `APPROVAL#PENDING`, SK created timestamp and user sub. | Admin only. No Cognito login implies application access without an approved item. |
| User permissions | `IdentityAccess` PK `USER#<Cognito sub>`, SK `PROFILE`. | Read on every request (short cache only if invalidated on changes). |
| Restore screen and history | `AuditLog` GSI `DeletedIndex`, PK `DELETED#<programId>`; entity history PK `ENTITY#<type>#<id>`, SK timestamp and audit ID. | Admin only; restore writes a new audit entry. |
| File metadata | `ProgramOperations` PK `PROGRAM#<programId>`, SK `FILE#<timestamp>#<id>`. | API issues short-lived upload/download URLs only after permission checks. Bytes stay in private S3. |

Queries require bounded date ranges and pagination. Cross-program reports fan out across the requested user's assigned programs. Location and facilitator filters select their respective indexes and apply the remaining approved filters after query. This avoids table scans, though broad yearly ranges can still require many paginated reads. No reporting summary table is planned initially; add one only after measured report latency/volume requires it, with idempotent event-version updates and reconciliation.

## DynamoDB items and keys

`ProgramOperations` (on-demand, PITR): `PK`/`SK`, `LocationDateIndex` (`GSI1PK`/`GSI1SK`), `FacilitatorDateIndex` (`GSI2PK`/`GSI2SK`), `AssigneeDueIndex` (`GSI3PK`/`GSI3SK`). Examples:

```json
{"PK":"PROGRAM#udyam","SK":"EVENT#2026-07-18#01J...","id":"01J...","type":"activity","activityType":"digital-session","date":"2026-07-18","locationId":"loc_01J...","facilitatorId":"staff_01J...","attendanceTotal":22,"participantIds":["stu_01J..."],"version":1,"deletedAt":null,"GSI1PK":"LOCATION#loc_01J...","GSI1SK":"DATE#2026-07-18#EVENT#01J...","GSI2PK":"STAFF#staff_01J...","GSI2SK":"DATE#2026-07-18#EVENT#01J..."}
{"PK":"PROGRAM#sambodhi","SK":"TASK#2026-08-01#01J...","id":"01J...","type":"task","assigneeId":"staff_01J...","status":"open","GSI3PK":"ASSIGNEE#staff_01J...","GSI3SK":"DUE#2026-08-01#TASK#01J..."}
```

`Students` (on-demand, PITR): `PK`/`SK`, `ProgramEnrollmentIndex` (`GSI1PK`/`GSI1SK`). A student has one profile and one current enrollment item per program; dated history is append-only. Stable `stu_` IDs survive name changes.

```json
{"PK":"STUDENT#stu_01J...","SK":"PROFILE","id":"stu_01J...","name":"Synthetic Student","createdAt":"2026-07-18T10:00:00Z"}
{"PK":"STUDENT#stu_01J...","SK":"ENROLLMENT#llp","programId":"llp","status":"active","locationId":"loc_01J...","dropOutStatus":null,"GSI1PK":"PROGRAM#llp#STATUS#active","GSI1SK":"LOCATION#loc_01J...#STUDENT#stu_01J..."}
{"PK":"STUDENT#stu_01J...","SK":"HISTORY#2026-07-18#01J...","kind":"enrollment","programId":"llp","from":null,"to":"active","effectiveDate":"2026-07-18"}
```

`AuditLog` (on-demand, PITR): `PK`/`SK`, `DeletedIndex` (`GSI1PK`/`GSI1SK`). Each mutation records actor, time, entity, action, and safe before/after field names; sensitive student values do not go into logs. The audit item and source update are written transactionally where possible.

`IdentityAccess` (on-demand, PITR): `PK` `USER#<sub>`, `SK` `PROFILE`; `ApprovalIndex` (`GSI1PK`/`GSI1SK`). Profile contains `status` (`pending`, `approved`, `suspended`), one role (`admin`, `program_manager`, `facilitator`), assigned `programIds`, optional stable staff ID, and version. A Google provider group is never an application role.

School/centre and staff identity records can begin as `ProgramOperations` directory items with generated `loc_` and `staff_` IDs. If their independent scale or lifecycle warrants it, split them into dedicated tables without changing event IDs.

## Implementation order

1. Inventory all four workbooks and write a field crosswalk, raw-value catalog, and reconciliation questions. **Pending files.**
2. Build shared TypeScript schemas, date/program-year functions, report calculations, and tests. Establish the API domain boundaries and authorization middleware.
3. Build the React screens: dashboard, records, registry, tasks, reports, approval, and restore. Use only API endpoints for protected data.
4. Implement DynamoDB repositories, transactional audit writes, S3 file metadata and presigned URLs, Cognito JWT verification, and protected exports.
5. Add local Docker Compose with DynamoDB Local and synthetic seed data. Mock identity is development-only and rejected in production.
6. Replace the existing hosting-only stack with staged CloudFormation for private S3 static assets, CloudFront API routing, Fargate API, Cognito, DynamoDB, IAM, alarms, and outputs. Validate in AWS without deploying.
7. Add workbook migration dry-run and reconciliation reports after the actual files are inspected. Test corrections, backdated entries, soft deletion, and permission boundaries.

No AWS deployment is part of this refactor without a new explicit request.
