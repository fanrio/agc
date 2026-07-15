'use strict';

/**
 * HanaClient
 *
 * Low-level SAP HANA driver wrapper.
 *
 * FLAT_TABLE constant intentionally uses the corrected spelling "authorization_flat".
 * NOTE: If you have existing HANA databases with the old misspelled table
 * "authoriziation_flat" (double 'i'), run the following migration SQL once per schema:
 *   RENAME TABLE "<schema>"."authoriziation_flat" TO "<schema>"."authorization_flat";
 */

let hanaDriver = require('@sap/hana-client');

// Single source of truth for the flat table name (fixes audit finding F-23)
const FLAT_TABLE = 'authorization_flat';

class HanaClient {
  /**
   * Set dynamic custom driver mock/spy for testing
   */
  static setDriver(customDriver) {
    hanaDriver = customDriver;
  }

  static getParams(setting) {
    return {
      serverNode:              `${setting.host}:${setting.port || 443}`,
      uid:                     setting.username,
      pwd:                     setting.password,
      encrypt:                 'true',
      sslValidateCertificate:  'true',
      sslHostNameInCertificate: setting.host,
      pooling:                 'true',
      maxPoolSize:             10
    };
  }

  static validateUsername(username) {
    // Trim whitespace first (guards against accidental trailing spaces stored in DB)
    const trimmed = (username || '').trim();
    // SAP HANA usernames / schema names allow: letters, digits, underscore, hash (#),
    // dollar sign ($) and dot (.) — e.g. "HH_SAP#AEISELE", "SAP$USER", "MY.SCHEMA"
    if (!trimmed || !/^[a-zA-Z0-9_.#$]+$/.test(trimmed)) {
      throw new Error(`Invalid schema name/username: [${username}] - potential SQL injection blocked`);
    }
    return trimmed;
  }

  /**
   * Helper to execute a single query with automatic connect/disconnect.
   * Supports optional bound parameters to avoid SQL injection.
   */
  static async execute(setting, sql, params = []) {
    // Guard only — throws on invalid username before connecting (prevents SQL injection via username)
    this.validateUsername(setting.username);
    const conn       = hanaDriver.createConnection();
    const connParams = this.getParams(setting);

    return new Promise((resolve, reject) => {
      conn.connect(connParams, (err) => {
        if (err) return reject(new Error(`Hana connection failed: ${err.message}`));

        const callback = (execErr, rows) => {
          conn.disconnect();
          if (execErr) return reject(new Error(`Query execution failed: ${execErr.message}`));
          resolve(rows);
        };

        if (params && params.length > 0) {
          conn.exec(sql, params, callback);
        } else {
          conn.exec(sql, callback);
        }
      });
    });
  }

  /**
   * Tests the HANA connection and ensures the authorization flat table exists.
   */
  static async testConnectionAndCreateTable(setting) {
    const schemaName = this.validateUsername(setting.username);
    const conn       = hanaDriver.createConnection();
    const connParams = this.getParams(setting);

    return new Promise((resolve) => {
      conn.connect(connParams, (err) => {
        if (err) {
          resolve({ success: false, message: `Hana database connection failed: ${err.message}` });
          return;
        }
        conn.disconnect(() => {
          resolve({
            success: true,
            message: `Successfully connected to SAP Hana database.`
          });
        });
      });
    });
  }

  /**
   * Dynamically creates a custom hierarchy authorization table in HANA.
   * Schema matches the SAP Datasphere Hierarchy with Directory DAC permissions entity.
   */
  static async createCustomHierTable(setting, tableName) {
    const schemaName = this.validateUsername(setting.username);
    const conn       = hanaDriver.createConnection();
    const connParams = this.getParams(setting);

    return new Promise((resolve) => {
      conn.connect(connParams, (err) => {
        if (err) {
          console.error(`[HanaClient] Connection failed for hier table creation ${tableName}:`, err.message);
          resolve({ success: false, message: `Hana database connection failed: ${err.message}` });
          return;
        }

        const createSql = `CREATE TABLE "${schemaName}"."${tableName}" (
           "PERMISSION_ID"         NVARCHAR(100) PRIMARY KEY,
           "IDENTIFIER"            NVARCHAR(150),
           "RESTRICTION"           NVARCHAR(200),
           "TARGET_NODE_TYPE"      NVARCHAR(100),
           "ROOT_NODE_TYPE"        NVARCHAR(100),
           "ROOT_VALUES"           NVARCHAR(1333),
           "HIERARCHY_IDENTIFIERS" NVARCHAR(200)
        )`;

        conn.exec(createSql, (execErr) => {
          if (execErr) {
            const isAlreadyExists = execErr.code === 288 ||
              execErr.message.toLowerCase().includes('already exists') ||
              execErr.message.toLowerCase().includes('duplicate table name');
            if (!isAlreadyExists) {
              console.error(`[HanaClient] Failed to create custom hier table ${tableName}:`, execErr.message);
            }
          } else {
            console.log(`[HanaClient] Successfully created custom hier table: "${schemaName}"."${tableName}"`);
          }
          conn.disconnect(() => {
            resolve({ success: !execErr || execErr.code === 288 });
          });
        });
      });
    });
  }

  /**
   * Dynamically drops a custom table in HANA.
   */
  static async dropCustomTable(setting, tableName) {
    const schemaName = this.validateUsername(setting.username);
    if (!tableName || !/^[a-zA-Z0-9_]+$/.test(tableName)) {
      throw new Error(`Invalid table name for drop: [${tableName}]`);
    }
    const sql = `DROP TABLE "${schemaName}"."${tableName}"`;
    try {
      await this.execute(setting, sql);
      console.log(`[HanaClient] Successfully dropped custom table: "${schemaName}"."${tableName}"`);
      return { success: true };
    } catch (execErr) {
      const isNotExists = execErr.message.toLowerCase().includes('invalid table name') ||
                          execErr.message.toLowerCase().includes('does not exist');
      if (!isNotExists) {
        console.error(`[HanaClient] Failed to drop custom table ${tableName}:`, execErr.message);
      }
      return { success: isNotExists };
    }
  }

  /**
   * Dynamically creates a custom flat authorization table in HANA.
   */
  static async createCustomFlatTable(setting, tableName) {
    const schemaName = this.validateUsername(setting.username);
    const conn       = hanaDriver.createConnection();
    const connParams = this.getParams(setting);

    return new Promise((resolve) => {
      conn.connect(connParams, (err) => {
        if (err) {
          console.error(`[HanaClient] Connection failed for table creation ${tableName}:`, err.message);
          resolve({ success: false, message: `Hana database connection failed: ${err.message}` });
          return;
        }

        const createSql = `CREATE TABLE "${schemaName}"."${tableName}" (
           "id" VARCHAR(100) PRIMARY KEY,
           "identifier" VARCHAR(150),
           "restricion" VARCHAR(250),
           "criterion" VARCHAR(50),
           "operartor" VARCHAR(2),
           "first_value" VARCHAR(1333),
           "second_value" VARCHAR(1333),
           "original_role" VARCHAR(200),
           "created_timestamp" TIMESTAMP,
           "changed_timestamp" TIMESTAMP
        )`;

        conn.exec(createSql, (execErr) => {
          if (execErr) {
            const isAlreadyExists = execErr.code === 288 ||
              execErr.message.toLowerCase().includes('already exists') ||
              execErr.message.toLowerCase().includes('duplicate table name');
            if (!isAlreadyExists) {
              console.error(`[HanaClient] Failed to create custom table ${tableName}:`, execErr.message);
            }
          } else {
            console.log(`[HanaClient] Successfully created custom flat table: "${schemaName}"."${tableName}"`);
          }
          conn.disconnect(() => {
            resolve({ success: !execErr || execErr.code === 288 });
          });
        });
      });
    });
  }

  /**
   * Performs flat table synchronization for a role assignment with transaction safety.
   *
   * @param {object}   setting       - BdcSettings record (host, port, username, password, systemName)
   * @param {string}   assignmentId  - RoleAssignment ID used as row ID prefix
   * @param {boolean}  isDelete      - when true, removes rows without inserting new ones
   * @param {object[]} restrictions  - flat table row objects { userId, roleName, field, operator, low, high }
   */
  static async syncAssignment(setting, assignmentId, isDelete, restrictions) {
    const schemaName = this.validateUsername(setting.username);
    const conn       = hanaDriver.createConnection();
    const connParams = this.getParams(setting);
    connParams.autoCommit = false; // Disable autocommit for transactional safety

    return new Promise((resolve, reject) => {
      conn.connect(connParams, (err) => {
        if (err) {
          return reject(new Error(`Failed to connect to HANA database [${setting.systemName}] for sync: ${err.message}`));
        }

        const rollbackAndReject = (errorMsg) => {
          conn.rollback(() => {
            conn.disconnect(() => {
              reject(new Error(errorMsg));
            });
          });
        };

        const deleteSql = `DELETE FROM "${schemaName}"."${FLAT_TABLE}" WHERE "ID" LIKE ?`;

        conn.prepare(deleteSql, (prepErr, stmt) => {
          if (prepErr) {
            return rollbackAndReject(`Failed to prepare delete query: ${prepErr.message}`);
          }

          stmt.exec([`${assignmentId}%`], (execErr) => {
            if (execErr) {
              return rollbackAndReject(`Failed to execute delete sync query: ${execErr.message}`);
            }

            if (isDelete || restrictions.length === 0) {
              conn.commit((commitErr) => {
                if (commitErr) {
                  return rollbackAndReject(`Failed to commit delete transaction: ${commitErr.message}`);
                }
                conn.disconnect(() => resolve());
              });
            } else {
              const insertSql = `INSERT INTO "${schemaName}"."${FLAT_TABLE}" ("ID", "USER", "ROLE", "FIELD", "OPERATOR", "LOW", "HIGH") VALUES (?, ?, ?, ?, ?, ?, ?)`;

              conn.prepare(insertSql, (insertPrepErr, insertStmt) => {
                if (insertPrepErr) {
                  return rollbackAndReject(`Failed to prepare insert query: ${insertPrepErr.message}`);
                }

                let insertCount = 0;
                let failed      = false;

                const checkAndResolve = () => {
                  if (failed) return;
                  if (insertCount === restrictions.length) {
                    conn.commit((commitErr) => {
                      if (commitErr) {
                        return rollbackAndReject(`Failed to commit insert transaction: ${commitErr.message}`);
                      }
                      conn.disconnect(() => resolve());
                    });
                  }
                };

                restrictions.forEach((r, idx) => {
                  const id = `${assignmentId}_${idx}`;
                  insertStmt.exec([
                    id,
                    r.userId,
                    r.roleName,
                    r.field,
                    r.operator,
                    r.low,
                    r.high || ''
                  ], (insertExecErr) => {
                    if (insertExecErr) {
                      failed = true;
                      return rollbackAndReject(`Failed to insert restriction row for ID ${id}: ${insertExecErr.message}`);
                    }
                    insertCount++;
                    checkAndResolve();
                  });
                });
              });
            }
          });
        });
      });
    });
  }

  /**
   * Performs flat table synchronization for a role assignment in a custom application context flat table.
   */
  static async syncCustomAssignment(setting, tableName, assignmentId, isDelete, restrictions, originalRoleName) {
    const schemaName = this.validateUsername(setting.username);
    const conn       = hanaDriver.createConnection();
    const connParams = this.getParams(setting);
    connParams.autoCommit = false; // Disable autocommit for transactional safety

    return new Promise((resolve, reject) => {
      conn.connect(connParams, (err) => {
        if (err) {
          return reject(new Error(`Failed to connect to HANA database [${setting.systemName}] for custom sync: ${err.message}`));
        }

        const rollbackAndReject = (errorMsg) => {
          conn.rollback(() => {
            conn.disconnect(() => {
              reject(new Error(errorMsg));
            });
          });
        };

        const deleteSql = `DELETE FROM "${schemaName}"."${tableName}" WHERE "id" LIKE ?`;

        conn.prepare(deleteSql, (prepErr, stmt) => {
          if (prepErr) {
            return rollbackAndReject(`Failed to prepare delete query on custom table ${tableName}: ${prepErr.message}`);
          }

          stmt.exec([`${assignmentId}%`], (execErr) => {
            if (execErr) {
              return rollbackAndReject(`Failed to execute delete query on custom table ${tableName}: ${execErr.message}`);
            }

            if (isDelete || restrictions.length === 0) {
              conn.commit((commitErr) => {
                if (commitErr) {
                  return rollbackAndReject(`Failed to commit delete on custom table ${tableName}: ${commitErr.message}`);
                }
                conn.disconnect(() => resolve());
              });
            } else {
              const insertSql = `INSERT INTO "${schemaName}"."${tableName}" (
                "id", "identifier", "restricion", "criterion", "operartor", 
                "first_value", "second_value", "original_role", "created_timestamp", "changed_timestamp"
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

              conn.prepare(insertSql, (insertPrepErr, insertStmt) => {
                if (insertPrepErr) {
                  return rollbackAndReject(`Failed to prepare insert on custom table ${tableName}: ${insertPrepErr.message}`);
                }

                let insertCount = 0;
                let failed      = false;

                const checkAndResolve = () => {
                  if (failed) return;
                  if (insertCount === restrictions.length) {
                    conn.commit((commitErr) => {
                      if (commitErr) {
                        return rollbackAndReject(`Failed to commit insert on custom table ${tableName}: ${commitErr.message}`);
                      }
                      conn.disconnect(() => resolve());
                    });
                  }
                };

                const now = new Date();

                restrictions.forEach((r, idx) => {
                  const id = `${assignmentId}_${idx}`;
                  insertStmt.exec([
                    id,
                    r.userId,
                    r.roleName,
                    r.field,
                    r.operator,
                    r.low,
                    r.high || '',
                    originalRoleName,
                    now,
                    now
                  ], (insertExecErr) => {
                    if (insertExecErr) {
                      failed = true;
                      return rollbackAndReject(`Failed to insert row for ID ${id} in custom table ${tableName}: ${insertExecErr.message}`);
                    }
                    insertCount++;
                    checkAndResolve();
                  });
                });
              });
            }
          });
        });
      });
    });
  }

  /**
   * Synchronizes a role assignment to a stream-specific *_hier_authorizations table.
   * Same schema as syncHierAssignment but targets the stream-namespaced table.
   *
   * @param {object}   setting       - BdcSettings record
   * @param {string}   tableName     - stream-specific hier table, e.g. "finance_hier_authorizations"
   * @param {string}   assignmentId  - RoleAssignment ID
   * @param {boolean}  isDelete      - when true, removes rows
   * @param {object[]} hierEntries   - hier row objects
   */
  static async syncCustomHierAssignment(setting, tableName, assignmentId, isDelete, hierEntries) {
    const schemaName = this.validateUsername(setting.username);
    const conn       = hanaDriver.createConnection();
    const connParams = this.getParams(setting);
    connParams.autoCommit = false;

    return new Promise((resolve, reject) => {
      conn.connect(connParams, (err) => {
        if (err) {
          return reject(new Error(`Failed to connect to HANA [${setting.systemName}] for custom hier sync: ${err.message}`));
        }

        const rollbackAndReject = (errorMsg) => {
          conn.rollback(() => conn.disconnect(() => reject(new Error(errorMsg))));
        };

        const deleteSql = `DELETE FROM "${schemaName}"."${tableName}" WHERE "PERMISSION_ID" LIKE ?`;

        conn.prepare(deleteSql, (prepErr, stmt) => {
          if (prepErr) return rollbackAndReject(`Failed to prepare hier delete on ${tableName}: ${prepErr.message}`);

          stmt.exec([`${assignmentId}%`], (execErr) => {
            if (execErr) return rollbackAndReject(`Failed to execute hier delete on ${tableName}: ${execErr.message}`);

            if (isDelete || hierEntries.length === 0) {
              conn.commit((commitErr) => {
                if (commitErr) return rollbackAndReject(`Failed to commit hier delete on ${tableName}: ${commitErr.message}`);
                conn.disconnect(() => resolve());
              });
            } else {
              const insertSql = `INSERT INTO "${schemaName}"."${tableName}" ` +
                `("PERMISSION_ID", "IDENTIFIER", "RESTRICTION", "TARGET_NODE_TYPE", "ROOT_NODE_TYPE", "ROOT_VALUES", "HIERARCHY_IDENTIFIERS") ` +
                `VALUES (?, ?, ?, ?, ?, ?, ?)`;

              const executeInserts = (insertStmt) => {
                let insertCount = 0;
                let failed      = false;

                const checkAndResolve = () => {
                  if (failed) return;
                  if (insertCount === hierEntries.length) {
                    conn.commit((commitErr) => {
                      if (commitErr) return rollbackAndReject(`Failed to commit hier insert on ${tableName}: ${commitErr.message}`);
                      conn.disconnect(() => resolve());
                    });
                  }
                };

                hierEntries.forEach((r, idx) => {
                  const id = `${assignmentId}_${idx}`;
                  insertStmt.exec([
                    id,
                    r.identifier,
                    r.restriction,
                    r.targetNodeType || '',
                    r.rootNodeType   || '',
                    r.rootValues,
                    r.hierIdentifier
                  ], (insertExecErr) => {
                    if (insertExecErr) {
                      failed = true;
                      return rollbackAndReject(`Failed to insert hier row ${id} on ${tableName}: ${insertExecErr.message}`);
                    }
                    insertCount++;
                    checkAndResolve();
                  });
                });
              };

              conn.prepare(insertSql, (insertPrepErr, insertStmt) => {
                if (insertPrepErr) {
                  const errMsg = insertPrepErr.message.toLowerCase();
                  if (errMsg.includes('identifier') || errMsg.includes('column') || errMsg.includes('invalid')) {
                    console.log(`[HanaClient] Detected missing IDENTIFIER column in custom hier table ${tableName}. Attempting auto-migration...`);
                    const alterSql = `RENAME COLUMN "${schemaName}"."${tableName}"."ID" TO "IDENTIFIER"`;
                    return conn.exec(alterSql, (alterErr) => {
                      if (alterErr) {
                        console.error(`[HanaClient] Auto-migration failed for ${tableName}:`, alterErr.message);
                        return rollbackAndReject(`Failed to prepare hier insert on ${tableName}: ${insertPrepErr.message}`);
                      }
                      console.log(`[HanaClient] Auto-migration successful for ${tableName}. Retrying insert prepare...`);
                      conn.prepare(insertSql, (retryPrepErr, retryStmt) => {
                        if (retryPrepErr) {
                          return rollbackAndReject(`Failed to prepare hier insert after migration on ${tableName}: ${retryPrepErr.message}`);
                        }
                        executeInserts(retryStmt);
                      });
                    });
                  }
                  return rollbackAndReject(`Failed to prepare hier insert on ${tableName}: ${insertPrepErr.message}`);
                }

                executeInserts(insertStmt);
              });
            }
          });
        });
      });
    });
  }
}

module.exports = HanaClient;
