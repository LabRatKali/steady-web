/**
 * GitHub Contents API client — same paths as Android FamilySync / ParentApprovalSync.
 */
(function (global) {
  const API = "https://api.github.com";

  function familyFolder(pairCode) {
    const cleaned = String(pairCode || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    return cleaned.slice(0, 12) || "unknown";
  }

  class SteadyGithub {
    constructor({ token, repo, pairCode, familySecret }) {
      this.token = String(token || "").trim();
      this.repo = String(repo || "LabRatKali/steady-sync").trim();
      this.pairCode = String(pairCode || "").trim();
      this.familySecret = String(familySecret || "").trim();
      this.folder = familyFolder(this.pairCode);
    }

    headers(extra) {
      return Object.assign(
        {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "Steady-Web-Dashboard",
        },
        extra || {}
      );
    }

    async api(path, opts) {
      const res = await fetch(`${API}/repos/${this.repo}/contents/${path}`, {
        ...opts,
        headers: this.headers(opts && opts.headers),
      });
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch (_) {
        json = null;
      }
      return { ok: res.ok, status: res.status, json, text };
    }

    async listDir(path) {
      const { ok, status, json } = await this.api(path, { method: "GET" });
      if (status === 404) return [];
      if (!ok) throw new Error(`List failed (${status})`);
      if (!Array.isArray(json)) return [];
      return json;
    }

    async getDecoded(path) {
      const { ok, status, json } = await this.api(path, { method: "GET" });
      if (status === 404) return { exists: false, sha: null, data: null };
      if (!ok) throw new Error(`Get failed (${status}): ${path}`);
      const b64 = String(json.content || "").replace(/\n/g, "");
      const raw = atob(b64);
      const plain = SteadyCrypto.decode(raw);
      return { exists: true, sha: json.sha, data: JSON.parse(plain), raw };
    }

    async putEncoded(path, obj, message) {
      const encoded = SteadyCrypto.encode(JSON.stringify(obj));
      let sha = null;
      const existing = await this.api(path, { method: "GET" });
      if (existing.ok && existing.json && existing.json.sha) {
        sha = existing.json.sha;
      }
      const body = {
        message: message || "Steady web dashboard",
        content: btoa(encoded),
      };
      if (sha) body.sha = sha;
      const { ok, status, text } = await this.api(path, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!ok && status !== 422) {
        throw new Error(`Put failed (${status}): ${String(text).slice(0, 180)}`);
      }
    }

    policyPath(childId) {
      return `families/${this.folder}/policy/${childId}.json.enc`;
    }

    todosPath(childId) {
      return `families/${this.folder}/todos/${childId}.json.enc`;
    }

    appsPath(childId) {
      return `families/${this.folder}/apps/${childId}.json.enc`;
    }

    phonesPath(deviceId) {
      return `families/${this.folder}/phones/${deviceId}.json.enc`;
    }

    async listPendingApprovals(childFilter) {
      const entries = await this.listDir("parent/queue");
      const out = [];
      for (const e of entries) {
        if (!e.name || !e.name.endsWith(".json.enc")) continue;
        if (childFilter && !e.name.startsWith(childFilter)) continue;
        try {
          const got = await this.getDecoded(`parent/queue/${e.name}`);
          if (got.data && got.data.status === "PENDING") out.push(got.data);
        } catch (_) {
          /* skip corrupt */
        }
      }
      out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      return out;
    }

    async publishDecision(payload) {
      const path = `parent/decisions/${payload.childDeviceId}_${payload.id}.json.enc`;
      await this.putEncoded(path, payload, `decision ${payload.status}`);
    }

    async fetchPolicy(childId) {
      return this.getDecoded(this.policyPath(childId));
    }

    async publishPolicy(policy) {
      await this.putEncoded(
        this.policyPath(policy.childDeviceId),
        policy,
        "policy from Steady web"
      );
    }

    async fetchTodos(childId) {
      return this.getDecoded(this.todosPath(childId));
    }

    async publishTodos(payload) {
      await this.putEncoded(
        this.todosPath(payload.childDeviceId),
        payload,
        "todos from Steady web"
      );
    }

    async fetchApps(childId) {
      return this.getDecoded(this.appsPath(childId));
    }

    async listFamilyPhones() {
      const entries = await this.listDir(`families/${this.folder}/phones`);
      const phones = [];
      for (const e of entries) {
        if (!e.name || !e.name.endsWith(".json.enc")) continue;
        try {
          const got = await this.getDecoded(
            `families/${this.folder}/phones/${e.name}`
          );
          if (got.data) phones.push(got.data);
        } catch (_) {}
      }
      return phones;
    }

    async fetchLiveLocation(childId) {
      const candidates = [
        `family/location/${childId}.json.enc`,
        `families/${this.folder}/location/${childId}.json.enc`,
      ];
      for (const path of candidates) {
        try {
          const got = await this.getDecoded(path);
          if (got.exists) return got;
        } catch (_) {}
      }
      return { exists: false, data: null };
    }

    async decideApproval(req, approve, minutes) {
      const secret = this.familySecret || this.pairCode;
      const status = approve ? "APPROVED" : "DENIED";
      const mins =
        minutes == null
          ? req.requestedMinutes || 5
          : minutes;
      const nonce = Math.random().toString(36).slice(2, 14);
      const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
      const payloadStr = SteadyCrypto.decisionPayload(
        req.id,
        status,
        mins < 0 ? -1 : mins,
        nonce,
        expiresAt
      );
      const signature = secret
        ? await SteadyCrypto.hmacSha256Hex(secret, payloadStr)
        : "";
      const decision = Object.assign({}, req, {
        status,
        approvedMinutes: approve ? mins : null,
        nonce,
        expiresAt,
        signature,
      });
      await this.publishDecision(decision);
      return decision;
    }
  }

  global.SteadyGithub = SteadyGithub;
  global.steadyFamilyFolder = familyFolder;
})(window);
