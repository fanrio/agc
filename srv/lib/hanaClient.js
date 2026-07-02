let hanaDriver = require('@sap/hana-client');

class HanaClient {
  /**
   * Set dynamic custom driver mock/spy for testing
   */
  static setDriver(customDriver) {
    hanaDriver = customDriver;
  }

  static getParams(setting) {
    return {
      serverNode: `${setting.host}:${setting.port || 443}`,
      uid: setting.username,
      pwd: setting.password,
      encrypt: 'true',
      sslValidateCertificate: 'true',
      sslHostNameInCertificate: setting.host
    };
  }

  static validateUsername(username) {
    if (!username || !/^[a-zA-Z0-9_]+$/.test(username)) {
      throw new Error(`Invalid schema name/username: [${username}] - potential SQL injection blocked`);
    }
  }

  /**
   * Helper to execute a single query with automatic connect/disconnect
   */
  static async execute(setting, sql, params = []) {
    this.validateUsername(setting.username);
    const conn = hanaDriver.createConnection();
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
   * Helper to test connection and ensure flat table exists
   */
  static async testConnectionAndCreateTable(setting) {
    this.validateUsername(setting.username);
    const conn = hanaDriver.createConnection();
    const connParams = this.getParams(setting);

    return new Promise((resolve) => {
      conn.connect(connParams, (err) => {
        if (err) {
          resolve({ success: false, message: `Hana database connection failed: ${err.message}` });
          return;
        }

        const createSql = `CREATE TABLE "${setting.username}"."authoriziation_flat" (
           "ID" VARCHAR(100) PRIMARY KEY,
           "USER" VARCHAR(150),
           "ROLE" VARCHAR(150),
           "FIELD" VARCHAR(50),
           "OPERATOR" VARCHAR(2),
           "LOW" VARCHAR(1333),
           "HIGH" VARCHAR(1333)
        )`;

        conn.exec(createSql, (execErr) => {
          if (execErr) {
            const isAlreadyExists = execErr.code === 288 || 
                                    execErr.message.toLowerCase().includes('already exists') || 
                                    execErr.message.toLowerCase().includes('duplicate table name');
            if (!isAlreadyExists) {
              console.error("Failed to create table:", execErr);
            }
          }
          conn.disconnect(() => {
            resolve({
              success: true,
              message: `Successfully connected to SAP Hana database. Table "${setting.username}"."authoriziation_flat" is verified/created.`
            });
          });
        });
      });
    });
  }

  /**
   * Performs flat table synchronization for a role assignment with transaction safety
   */
  static async syncAssignment(setting, assignmentId, isDelete, restrictions) {
    this.validateUsername(setting.username);
    const conn = hanaDriver.createConnection();
    const connParams = this.getParams(setting);

    return new Promise((resolve, reject) => {
      conn.connect(connParams, (err) => {
        if (err) {
          return reject(new Error(`Failed to connect to HANA database [${setting.systemName}] for sync: ${err.message}`));
        }

        // Set auto-commit off to start transactional boundary
        conn.setAutoCommit(false, (autoCommitErr) => {
          if (autoCommitErr) {
            conn.disconnect();
            return reject(new Error(`Failed to disable auto-commit: ${autoCommitErr.message}`));
          }

          const rollbackAndReject = (errorMsg) => {
            conn.rollback(() => {
              conn.disconnect(() => {
                reject(new Error(errorMsg));
              });
            });
          };

          const deleteSql = `DELETE FROM "${setting.username}"."authoriziation_flat" WHERE "ID" LIKE ?`;
          
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
                const insertSql = `INSERT INTO "${setting.username}"."authoriziation_flat" ("ID", "USER", "ROLE", "FIELD", "OPERATOR", "LOW", "HIGH") VALUES (?, ?, ?, ?, ?, ?, ?)`;
                
                conn.prepare(insertSql, (insertPrepErr, insertStmt) => {
                  if (insertPrepErr) {
                    return rollbackAndReject(`Failed to prepare insert query: ${insertPrepErr.message}`);
                  }

                  let insertCount = 0;
                  let failed = false;

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
    });
  }
}

module.exports = HanaClient;
