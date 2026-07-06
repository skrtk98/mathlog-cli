---
title: Mathlog syntax preview
tags:
  - syntax
private: false
---

# Mathlog syntax preview

## ラベル付き見出し [heading-label]

[この見出しへのリンク](#heading-label)

ここで、$x_i>0$ かつ $a \ne 0$ とします。

**太字赤色**、*斜体*、***斜体太字赤色***、~~取り消し~~。

![dummy image](https://example.com/image.png =500)

(1) 丸括弧の番号あり
	- 下位項目1
	- 下位項目2
(2) 2つ目

[1] 角括弧の番号あり
[2] 2つ目

R1. ローマン数字の番号あり
R2. 2つ目

(R1) 丸括弧のローマン数字
(R2) 2つ目

[R1] 角括弧のローマン数字
[R2] 2つ目

$$
\TextCenter
\sin(\alpha+\beta) = \sin(\alpha)\cos(\beta)+\cos(\alpha)\sin(\beta)
$$

\begin{eqnarray}
f(x)
&=& x^2 - 1 \\
&=& (x-1)(x+1)
\end{eqnarray}

&&&def 三角関数 [trig-def]
三角関数は角に対して定まる関数です。

- $\sin x$
- $\cos x$
&&&

&&&thm 加法定理 [addition-theorem]
任意の実数 $\alpha,\beta$ について、[[trig-def]] の記法を使うと次が成り立ちます。

$$
\sin(\alpha+\beta) = \sin\alpha\cos\beta+\cos\alpha\sin\beta
$$
&&&

&&&prf
[[addition-theorem]] は単位円上の回転から従います。
&&&
