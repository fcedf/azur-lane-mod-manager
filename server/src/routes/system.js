import { Router } from 'express';
import os from 'node:os';
import { success } from '../utils/response.js';

const router = Router();

/**
 * GET /api/system/lan-ip
 * 返回本机局域网 IPv4 地址，用于生成手机可访问的链接（无需登录）
 */
router.get('/lan-ip', (req, res, next) => {
  try {
    const nets = os.networkInterfaces();
    const ips = [];
    // 虚拟网卡关键词（VMware / VirtualBox / Hyper-V 等），手机无法通过它们访问
    const VIRTUAL = /vmware|virtualbox|vethernet|hyper-v|虚拟|loopback|docker|tailscale|zerotier/i;
    // 物理网卡常见名称（中英文）
    const PHYSICAL = /wlan|wi-?fi|无线|以太网|ethernet|本地连接|local area/i;

    for (const [name, addrs] of Object.entries(nets)) {
      for (const a of addrs || []) {
        if (a.family === 'IPv4' && !a.internal) {
          ips.push({ address: a.address, name, virtual: VIRTUAL.test(name) });
        }
      }
    }

    const physical = ips.filter((i) => !i.virtual);
    const pool = physical.length ? physical : ips; // 若没识别到物理网卡，退回全部

    // 优先物理网卡名称，其次常见家用网段
    const preferred =
      pool.find((i) => PHYSICAL.test(i.name)) ||
      pool.find((i) => i.address.startsWith('192.168.')) ||
      pool.find((i) => i.address.startsWith('10.')) ||
      pool[0] ||
      null;
    return success(res, { ips, preferred: preferred?.address || null });
  } catch (e) {
    next(e);
  }
});

export default router;
