export default {
  "flows": {
    "LooplineSignup/empty": {
      "meta": {
        "title": "Empty form",
        "description": "Initial blank Loopline signup form",
        "author": "dfosco"
      },
      "signup": {
        "fullName": "",
        "email": "",
        "company": "",
        "password": "",
        "agreedToTerms": false
      }
    },
    "LooplineSignup/prefilled": {
      "meta": {
        "title": "Prefilled",
        "description": "Form prefilled with sample values",
        "author": "dfosco"
      },
      "signup": {
        "fullName": "Ada Lovelace",
        "email": "ada@example.com",
        "company": "Analytical Engines",
        "password": "********",
        "agreedToTerms": true
      }
    },
    "LooplineSignup/submitting": {
      "meta": {
        "title": "Submitting",
        "description": "Form submitted, awaiting response",
        "author": "dfosco"
      },
      "signup": {
        "fullName": "Ada Lovelace",
        "email": "ada@example.com",
        "company": "Analytical Engines",
        "password": "********",
        "agreedToTerms": true,
        "status": "submitting"
      }
    },
    "LooplineSignup/success": {
      "meta": {
        "title": "Success",
        "description": "Account created successfully",
        "author": "dfosco"
      },
      "signup": {
        "fullName": "Ada Lovelace",
        "email": "ada@example.com",
        "company": "Analytical Engines",
        "password": "********",
        "agreedToTerms": true,
        "status": "success"
      }
    },
    "SiloDashboard/default": {
      "meta": {
        "author": "dfosco"
      },
      "workspace": {
        "name": "nimbus-forge",
        "silo": "Acropolis"
      },
      "user": {
        "name": "Idris Okafor",
        "username": "idris"
      },
      "view": "utilization",
      "nav": {
        "sections": [
          {
            "title": "NIMBUS-FORGE",
            "items": [
              {
                "label": "Projects",
                "icon": "file",
                "view": "projects",
                "create": "project"
              },
              {
                "label": "Images",
                "icon": "image"
              },
              {
                "label": "Utilization",
                "icon": "zap",
                "view": "utilization"
              },
              {
                "label": "Silo Access",
                "icon": "key"
              }
            ]
          }
        ]
      },
      "summary": {
        "cpu": {
          "label": "CPU",
          "percent": 42.5,
          "provisioned": 17,
          "quota": 40,
          "unit": "vCPUs"
        },
        "memory": {
          "label": "Memory",
          "percent": 71.25,
          "provisioned": 285,
          "quota": 400,
          "unit": "GiB"
        },
        "storage": {
          "label": "Storage",
          "percent": 33.75,
          "provisioned": 2.7,
          "quota": 8,
          "unit": "TiB"
        }
      },
      "timeRange": {
        "label": "Last hour",
        "from": "16/05/2026, 22:42",
        "to": "16/05/2026, 23:42"
      }
    }
  },
  "objects": {
    "SiloDashboard/metrics": {
      "cpu": [
        {
          "t": "22:44",
          "v": 393.5
        },
        {
          "t": "22:46",
          "v": 415.5
        },
        {
          "t": "22:48",
          "v": 454.8
        },
        {
          "t": "22:50",
          "v": 400.6
        },
        {
          "t": "22:52",
          "v": 422.1
        },
        {
          "t": "22:54",
          "v": 408.4
        },
        {
          "t": "22:56",
          "v": 388.7
        },
        {
          "t": "22:58",
          "v": 392.2
        },
        {
          "t": "23:00",
          "v": 448
        },
        {
          "t": "23:02",
          "v": 445.4
        },
        {
          "t": "23:04",
          "v": 413.4
        },
        {
          "t": "23:06",
          "v": 451.2
        },
        {
          "t": "23:08",
          "v": 448.1
        },
        {
          "t": "23:10",
          "v": 433.1
        },
        {
          "t": "23:12",
          "v": 435.4
        },
        {
          "t": "23:14",
          "v": 414.3
        },
        {
          "t": "23:16",
          "v": 398.8
        },
        {
          "t": "23:18",
          "v": 418.2
        },
        {
          "t": "23:20",
          "v": 431.6
        },
        {
          "t": "23:22",
          "v": 398.1
        },
        {
          "t": "23:24",
          "v": 417
        },
        {
          "t": "23:26",
          "v": 447.4
        },
        {
          "t": "23:28",
          "v": 448.4
        },
        {
          "t": "23:30",
          "v": 449.3
        },
        {
          "t": "23:32",
          "v": 409.2
        },
        {
          "t": "23:34",
          "v": 427.3
        },
        {
          "t": "23:36",
          "v": 392.7
        },
        {
          "t": "23:38",
          "v": 404.6
        },
        {
          "t": "23:40",
          "v": 422.2
        },
        {
          "t": "23:42",
          "v": 404.7
        }
      ],
      "memory": [
        {
          "t": "22:44",
          "v": 215.7
        },
        {
          "t": "22:46",
          "v": 218.6
        },
        {
          "t": "22:48",
          "v": 220.7
        },
        {
          "t": "22:50",
          "v": 223.1
        },
        {
          "t": "22:52",
          "v": 224.3
        },
        {
          "t": "22:54",
          "v": 228.3
        },
        {
          "t": "22:56",
          "v": 230.5
        },
        {
          "t": "22:58",
          "v": 232.2
        },
        {
          "t": "23:00",
          "v": 234.4
        },
        {
          "t": "23:02",
          "v": 235.6
        },
        {
          "t": "23:04",
          "v": 240
        },
        {
          "t": "23:06",
          "v": 242.7
        },
        {
          "t": "23:08",
          "v": 245.1
        },
        {
          "t": "23:10",
          "v": 245.5
        },
        {
          "t": "23:12",
          "v": 247.9
        },
        {
          "t": "23:14",
          "v": 250.8
        },
        {
          "t": "23:16",
          "v": 252.4
        },
        {
          "t": "23:18",
          "v": 256.9
        },
        {
          "t": "23:20",
          "v": 259.5
        },
        {
          "t": "23:22",
          "v": 261.5
        },
        {
          "t": "23:24",
          "v": 264.2
        },
        {
          "t": "23:26",
          "v": 265.8
        },
        {
          "t": "23:28",
          "v": 267.6
        },
        {
          "t": "23:30",
          "v": 270.7
        },
        {
          "t": "23:32",
          "v": 273.6
        },
        {
          "t": "23:34",
          "v": 274.3
        },
        {
          "t": "23:36",
          "v": 277.2
        },
        {
          "t": "23:38",
          "v": 280.5
        },
        {
          "t": "23:40",
          "v": 282.5
        },
        {
          "t": "23:42",
          "v": 284.4
        }
      ],
      "storage": [
        {
          "t": "22:44",
          "v": 2.705
        },
        {
          "t": "22:46",
          "v": 2.707
        },
        {
          "t": "22:48",
          "v": 2.704
        },
        {
          "t": "22:50",
          "v": 2.712
        },
        {
          "t": "22:52",
          "v": 2.708
        },
        {
          "t": "22:54",
          "v": 2.707
        },
        {
          "t": "22:56",
          "v": 2.688
        },
        {
          "t": "22:58",
          "v": 2.707
        },
        {
          "t": "23:00",
          "v": 2.7
        },
        {
          "t": "23:02",
          "v": 2.684
        },
        {
          "t": "23:04",
          "v": 2.716
        },
        {
          "t": "23:06",
          "v": 2.692
        },
        {
          "t": "23:08",
          "v": 2.709
        },
        {
          "t": "23:10",
          "v": 2.703
        },
        {
          "t": "23:12",
          "v": 2.692
        },
        {
          "t": "23:14",
          "v": 2.692
        },
        {
          "t": "23:16",
          "v": 2.68
        },
        {
          "t": "23:18",
          "v": 2.712
        },
        {
          "t": "23:20",
          "v": 2.685
        },
        {
          "t": "23:22",
          "v": 2.696
        },
        {
          "t": "23:24",
          "v": 2.681
        },
        {
          "t": "23:26",
          "v": 2.698
        },
        {
          "t": "23:28",
          "v": 2.681
        },
        {
          "t": "23:30",
          "v": 2.69
        },
        {
          "t": "23:32",
          "v": 2.699
        },
        {
          "t": "23:34",
          "v": 2.686
        },
        {
          "t": "23:36",
          "v": 2.707
        },
        {
          "t": "23:38",
          "v": 2.699
        },
        {
          "t": "23:40",
          "v": 2.719
        },
        {
          "t": "23:42",
          "v": 2.704
        }
      ]
    }
  },
  "records": {
    "SiloDashboard/projects": [
      {
        "id": "mock-project",
        "name": "mock-project",
        "description": "a fake project",
        "created": "2021-01-01T00:00:00.000Z"
      },
      {
        "id": "other-project",
        "name": "other-project",
        "description": "another fake project",
        "created": "2021-01-15T00:00:00.000Z"
      },
      {
        "id": "project-no-vpcs",
        "name": "project-no-vpcs",
        "description": "a project with no VPCs for testing",
        "created": "2021-01-20T00:00:00.000Z"
      }
    ]
  }
}
