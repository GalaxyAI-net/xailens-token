/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/xailens_lock.json`.
 */
export type XailensLock = {
  "address": "6urQa7RwSR1nW9tbYkGpaLznWL7WuFSmGHmwJZWcXTA9",
  "metadata": {
    "name": "xailensLock",
    "version": "0.2.0",
    "spec": "0.1.0",
    "description": "XAILENS token lock program (Solana, Anchor). Locks tokens to prove a holding threshold; no reward emission."
  },
  "instructions": [
    {
      "name": "acceptAuthority",
      "docs": [
        "Step 2 of authority transfer: the proposed authority accepts."
      ],
      "discriminator": [
        107,
        86,
        198,
        91,
        33,
        12,
        107,
        160
      ],
      "accounts": [
        {
          "name": "newAuthority",
          "signer": true
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  99,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "closeLockAccount",
      "docs": [
        "Close an empty lock account and return its rent to the owner."
      ],
      "discriminator": [
        147,
        250,
        205,
        58,
        255,
        181,
        210,
        3
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "lockAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "initialize",
      "docs": [
        "Create the single lock pool. Callable once, only by the program's",
        "upgrade authority, so nobody can front-run pool creation."
      ],
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "mint"
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  99,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "program",
          "docs": [
            "This program, used to locate its ProgramData account."
          ],
          "address": "6urQa7RwSR1nW9tbYkGpaLznWL7WuFSmGHmwJZWcXTA9"
        },
        {
          "name": "programData",
          "docs": [
            "The signer must be the program's upgrade authority."
          ]
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "poolParams"
            }
          }
        }
      ]
    },
    {
      "name": "lock",
      "docs": [
        "Lock `amount` XAILENS. Adds to any existing lock. Blocked while the pool",
        "is paused or while an unlock request is pending."
      ],
      "discriminator": [
        21,
        19,
        208,
        43,
        237,
        62,
        255,
        87
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  99,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "lockAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "userTokenAccount",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "proposeAuthority",
      "docs": [
        "Admin: step 1 of authority transfer (for example to a Squads multisig)."
      ],
      "discriminator": [
        20,
        148,
        236,
        198,
        76,
        119,
        99,
        142
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  99,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newAuthority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "requestUnlock",
      "docs": [
        "Start the unlock cooldown. The cooldown length is snapshotted so a",
        "later admin change cannot extend a pending request. Threshold clocks",
        "reset: an unlocking wallet no longer counts as holding."
      ],
      "discriminator": [
        114,
        219,
        84,
        115,
        190,
        220,
        130,
        240
      ],
      "accounts": [
        {
          "name": "user",
          "signer": true
        },
        {
          "name": "pool",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  99,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "lockAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "updatePool",
      "docs": [
        "Admin: update pool parameters. Cannot touch pending unlock requests."
      ],
      "discriminator": [
        239,
        214,
        170,
        78,
        36,
        35,
        30,
        34
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  99,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "update",
          "type": {
            "defined": {
              "name": "poolUpdate"
            }
          }
        }
      ]
    },
    {
      "name": "withdraw",
      "docs": [
        "Withdraw the full locked amount after the cooldown. Never blocked by",
        "pause."
      ],
      "discriminator": [
        183,
        18,
        70,
        156,
        148,
        109,
        161,
        34
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  99,
                  107,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "lockAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "userTokenAccount",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "lockAccount",
      "discriminator": [
        223,
        64,
        71,
        124,
        255,
        86,
        118,
        192
      ]
    },
    {
      "name": "lockPool",
      "discriminator": [
        57,
        9,
        171,
        89,
        205,
        211,
        78,
        84
      ]
    }
  ],
  "events": [
    {
      "name": "authorityProposed",
      "discriminator": [
        244,
        117,
        94,
        112,
        53,
        151,
        35,
        89
      ]
    },
    {
      "name": "authorityTransferred",
      "discriminator": [
        245,
        109,
        179,
        54,
        135,
        92,
        22,
        64
      ]
    },
    {
      "name": "locked",
      "discriminator": [
        188,
        53,
        118,
        62,
        64,
        12,
        198,
        84
      ]
    },
    {
      "name": "poolInitialized",
      "discriminator": [
        100,
        118,
        173,
        87,
        12,
        198,
        254,
        229
      ]
    },
    {
      "name": "poolUpdated",
      "discriminator": [
        218,
        43,
        210,
        231,
        127,
        214,
        72,
        245
      ]
    },
    {
      "name": "unlockRequested",
      "discriminator": [
        252,
        169,
        137,
        168,
        202,
        229,
        90,
        213
      ]
    },
    {
      "name": "withdrawn",
      "discriminator": [
        20,
        89,
        223,
        198,
        194,
        124,
        219,
        13
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "belowMinimumLock",
      "msg": "Lock amount is below the minimum of 1 XAILENS"
    },
    {
      "code": 6001,
      "name": "nothingLocked",
      "msg": "Nothing is locked"
    },
    {
      "code": 6002,
      "name": "stillLocked",
      "msg": "Lock account still holds tokens"
    },
    {
      "code": 6003,
      "name": "cooldownNotElapsed",
      "msg": "Cooldown period has not elapsed yet"
    },
    {
      "code": 6004,
      "name": "noUnlockRequested",
      "msg": "No unlock has been requested"
    },
    {
      "code": 6005,
      "name": "unlockAlreadyRequested",
      "msg": "Unlock has already been requested"
    },
    {
      "code": 6006,
      "name": "unauthorized",
      "msg": "Not authorized"
    },
    {
      "code": 6007,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6008,
      "name": "invalidCooldown",
      "msg": "Cooldown must be between 1 second and 30 days"
    },
    {
      "code": 6009,
      "name": "invalidThresholds",
      "msg": "Discount threshold must not exceed Founder threshold"
    },
    {
      "code": 6010,
      "name": "invalidAuthority",
      "msg": "Invalid authority"
    },
    {
      "code": 6011,
      "name": "poolPaused",
      "msg": "The pool is paused: no new locks (withdrawals still work)"
    }
  ],
  "types": [
    {
      "name": "authorityProposed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "current",
            "type": "pubkey"
          },
          {
            "name": "proposed",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "authorityTransferred",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "previous",
            "type": "pubkey"
          },
          {
            "name": "current",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "lockAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "docs": [
              "Raw locked amount."
            ],
            "type": "u64"
          },
          {
            "name": "lockedSince",
            "docs": [
              "When the current lock started (first deposit after an empty state)."
            ],
            "type": "i64"
          },
          {
            "name": "lastDepositAt",
            "docs": [
              "Most recent deposit."
            ],
            "type": "i64"
          },
          {
            "name": "discountSince",
            "docs": [
              "When the discount threshold was first met. 0 = not met."
            ],
            "type": "i64"
          },
          {
            "name": "founderSince",
            "docs": [
              "When the Founder threshold was first met. 0 = not met."
            ],
            "type": "i64"
          },
          {
            "name": "votingSince",
            "docs": [
              "When the voting threshold was first met. 0 = not met."
            ],
            "type": "i64"
          },
          {
            "name": "unlockRequestedAt",
            "docs": [
              "When unlock was requested. 0 = no pending request."
            ],
            "type": "i64"
          },
          {
            "name": "unlockCooldown",
            "docs": [
              "Cooldown snapshotted at request time."
            ],
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "lockPool",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "pendingAuthority",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "cooldownPeriod",
            "type": "i64"
          },
          {
            "name": "discountThreshold",
            "type": "u64"
          },
          {
            "name": "founderThreshold",
            "type": "u64"
          },
          {
            "name": "votingThreshold",
            "type": "u64"
          },
          {
            "name": "totalLocked",
            "type": "u64"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "locked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "totalLocked",
            "type": "u64"
          },
          {
            "name": "discountSince",
            "type": "i64"
          },
          {
            "name": "founderSince",
            "type": "i64"
          },
          {
            "name": "votingSince",
            "type": "i64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "poolInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "cooldownPeriod",
            "type": "i64"
          },
          {
            "name": "discountThreshold",
            "type": "u64"
          },
          {
            "name": "founderThreshold",
            "type": "u64"
          },
          {
            "name": "votingThreshold",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "poolParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "cooldownPeriod",
            "docs": [
              "Unlock cooldown in seconds (1 ..= MAX_COOLDOWN)."
            ],
            "type": "i64"
          },
          {
            "name": "discountThreshold",
            "docs": [
              "Raw amount (6 decimals) that qualifies for the subscription discount. 0 disables."
            ],
            "type": "u64"
          },
          {
            "name": "founderThreshold",
            "docs": [
              "Raw amount that qualifies for Founder-level benefits. 0 disables."
            ],
            "type": "u64"
          },
          {
            "name": "votingThreshold",
            "docs": [
              "Raw amount that qualifies for feature voting. 0 disables."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "poolUpdate",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "cooldownPeriod",
            "type": {
              "option": "i64"
            }
          },
          {
            "name": "discountThreshold",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "founderThreshold",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "votingThreshold",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "paused",
            "type": {
              "option": "bool"
            }
          }
        ]
      }
    },
    {
      "name": "poolUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "cooldownPeriod",
            "type": "i64"
          },
          {
            "name": "discountThreshold",
            "type": "u64"
          },
          {
            "name": "founderThreshold",
            "type": "u64"
          },
          {
            "name": "votingThreshold",
            "type": "u64"
          },
          {
            "name": "paused",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "unlockRequested",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "requestedAt",
            "type": "i64"
          },
          {
            "name": "cooldown",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "withdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    }
  ]
};
