# 小白发版教程

> 开发改代码的事 AI 会做。你只需要在改完后，把做好的安装包发布出去。

---

## 第一步：打开项目目录

打开 PowerShell（Win + R → 输入 `powershell` → 回车），然后**复制粘贴**下面这行命令：

```powershell
cd F:\fzz-Project\md-editor
```

> 这行命令的意思是：告诉电脑"我要在这个项目文件夹里干活"。

---

## 第二步：检查 CI 有没有完成

复制粘贴：

```powershell
gh run list --workflow=release.yml --limit 1 --json status,conclusion
```

你会看到类似这样的输出：

```
{"conclusion":"success","status":"completed"}
```

> 关注两点：
> - `status` 必须是 `"completed"`（做完了）
> - `conclusion` 必须是 `"success"`（成功了）
>
> 如果还在跑（`"in_progress"`），就等几分钟再检查一次。

---

## 第三步：检查安装包是否齐全

复制粘贴：

```powershell
gh release view v1.x.x
```

> 把 `v1.x.x` 换成真正的版本号，比如 `v1.2.13`。你会看到类似：

```
draft: true
asset: latest.json
asset: solo_1.2.13_x64-setup.exe
asset: solo_1.2.13_x64-setup.sig
```

> 确认三件事：
> 1. `draft: true`（正常，此时还只有你自己能看到）
> 2. 有 3 个 `asset`（.exe + .sig + latest.json）
> 3. 版本号正确（比如 `1.2.13`）

---

## 第四步：发布出去

复制粘贴（**记得换版本号**）：

```powershell
gh release edit v1.x.x --draft=false
```

> 这行命令的意思：把"草稿"变成"正式版"，这样所有用户才能收到更新。
>
> 如果成功会输出一个网页链接，像这样：
> `https://github.com/jloft198479-cyber/solo/releases/tag/v1.2.13`

---

## 第五步：在自己电脑上验证

打开你电脑上已安装的 solo 软件：

1. 点击左下角**设置**
2. 点**通用**
3. 点**检查更新**
4. 如果能弹出新版本的更新提示 → **大功告成 ✅**

---

## 常见问题

### Q：验证更新没反应，说已经是最新版

可能是你电脑上安装的版本已经是最新版了。可以看左下角关于里的版本号，如果已经是刚发布的版本就对了。

### Q：忘了版本号是多少

看这三个文件，里面的数字就是版本号：

```powershell
Select-String -Path package.json,src-tauri\Cargo.toml,src-tauri\tauri.conf.json -Pattern '"version"|version = "'
```

### Q：我什么都不会，怕搞坏

发布操作是**只读 + 发布**，不会搞坏代码。最坏情况就是发布失败了，重新来一次就行。

---

**总结：只需要跑 3 条命令，等 CI 几分钟，就完事了。**
