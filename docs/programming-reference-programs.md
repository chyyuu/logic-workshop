# 编程应用参考程序

第45–56关的合法参考汇编。可以尝试自己的算法，判题检查公开输入的输出事件、停止及必要内存。先导出个人存档备份，再导入programming-applications-demo.json可直接试玩。

所有程序使用现有门级CPU，不新增ISA指令；在汇编工作台粘贴源代码，点击“应用汇编”，然后“测试程序”。

## 第45关：第一个汇编程序

输出 42，且执行 HLT 正常停止。

公开用例：1组；参考长度：3字。

```asm
; 把立即数送到输出端口，然后停止
MOVI A, 42
OUT
HLT
```

## 第46关：字节运算与溢出

计算 250+13−5，输出八位结果 2，然后正常停止。

公开用例：1组；参考长度：7字。

```asm
MOVI A, 250
MOVI B, 13
ADD
MOVI B, 5
SUB
OUT
HLT
```

## 第47关：内存搬运

将 RAM[240] 复制到 RAM[242]，输出原字节，然后停止。目的单元初值与原字节不同。

公开用例：256组；参考长度：4字。

```asm
LOAD 240
STORE 242
OUT
HLT
```

## 第48关：倒计时循环

从 RAM[240] 读取 n，依次输出 n、n−1、…、0，然后停止。

公开用例：12组；参考长度：7字。

```asm
LOAD 240
MOVI B, 1
loop: OUT
JZ done
SUB
JMP loop
done: HLT
```

## 第49关：条件分支

输入 RAM[240] 为零时输出 0，其余字节输出 1，然后停止。

公开用例：14组；参考长度：5字。

```asm
LOAD 240
JZ zero
MOVI A, 1
zero: OUT
HLT
```

## 第50关：两数相加

输出 RAM[240]+RAM[241] 的模 256 结果，然后停止。

公开用例：12组；参考长度：16字。

```asm
; 244 保存第二个加数，245 保存累计结果
LOAD 240
STORE 245
LOAD 241
STORE 244
MOVI B, 1
loop: LOAD 244
JZ done
SUB
STORE 244
LOAD 245
ADD
STORE 245
JMP loop
done: LOAD 245
OUT
HLT
```

## 第51关：常数乘法

输出 3×RAM[240] 的模 256 结果，然后停止。

公开用例：14组；参考长度：18字。

```asm
LOAD 240
STORE 244
MOVI A, 0
STORE 245
MOVI B, 1
loop: LOAD 244
JZ done
SUB
STORE 244
LOAD 245
ADD
ADD
ADD
STORE 245
JMP loop
done: LOAD 245
OUT
HLT
```

## 第52关：累加求和

输出 1+2+…+n 的模 256 结果，n 来自 RAM[240]；n=0 时输出 0。

公开用例：12组；参考长度：23字。

```asm
; 外层从 n 倒数，内层将当前计数加到累计值
LOAD 240
STORE 244
MOVI A, 0
STORE 245
MOVI B, 1
outer: LOAD 244
JZ done
STORE 246
inner: LOAD 246
JZ next
SUB
STORE 246
LOAD 245
ADD
STORE 245
JMP inner
next: LOAD 244
SUB
STORE 244
JMP outer
done: LOAD 245
OUT
HLT
```

## 第53关：奇偶判断

输出 RAM[240] 的奇偶性：偶数输出 0，奇数输出 1，然后停止。

公开用例：14组；参考长度：13字。

```asm
; 每轮减两次一，在零和一处分别退出
LOAD 240
MOVI B, 1
loop: JZ even
SUB
JZ odd
SUB
JMP loop
even: MOVI A, 0
OUT
HLT
odd: MOVI A, 1
OUT
HLT
```

## 第54关：四格求和

输出 RAM[240]、RAM[241]、RAM[242]、RAM[243] 四个字节之和的模 256 结果。

公开用例：10组；参考长度：50字。

```asm
MOVI A, 0
STORE 245
MOVI B, 1
LOAD 240
STORE 244
loop0: LOAD 244
JZ next0
SUB
STORE 244
LOAD 245
ADD
STORE 245
JMP loop0
next0: NOP
LOAD 241
STORE 244
loop1: LOAD 244
JZ next1
SUB
STORE 244
LOAD 245
ADD
STORE 245
JMP loop1
next1: NOP
LOAD 242
STORE 244
loop2: LOAD 244
JZ next2
SUB
STORE 244
LOAD 245
ADD
STORE 245
JMP loop2
next2: NOP
LOAD 243
STORE 244
loop3: LOAD 244
JZ next3
SUB
STORE 244
LOAD 245
ADD
STORE 245
JMP loop3
next3: NOP
LOAD 245
OUT
HLT
```

## 第55关：斐波那契

输出 F(n) mod 256，n 来自 RAM[240]，F(0)=0、F(1)=1。

公开用例：12组；参考长度：31字。

```asm
; 244=前一项，245=当前项，246=剩余轮数
LOAD 240
JZ zero
MOVI B, 1
SUB
STORE 246
MOVI A, 0
STORE 244
MOVI A, 1
STORE 245
outer: LOAD 246
JZ done
SUB
STORE 246
LOAD 245
STORE 247
inner: LOAD 244
JZ next
SUB
STORE 244
LOAD 245
ADD
STORE 245
JMP inner
next: LOAD 247
STORE 244
JMP outer
done: LOAD 245
OUT
HLT
zero: OUT
HLT
```

## 第56关：两数相乘

输出 RAM[240]×RAM[241] 的模 256 结果，然后正常停止。

公开用例：21组；参考长度：22字。

```asm
; 每轮把乘数累加一次，内层用加一实现动态加法
LOAD 240
STORE 244
MOVI A, 0
STORE 245
MOVI B, 1
outer: LOAD 244
JZ done
SUB
STORE 244
LOAD 241
STORE 246
inner: LOAD 246
JZ outer
SUB
STORE 246
LOAD 245
ADD
STORE 245
JMP inner
done: LOAD 245
OUT
HLT
```

