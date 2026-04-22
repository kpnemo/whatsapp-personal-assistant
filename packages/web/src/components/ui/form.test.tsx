import { zodResolver } from "@hookform/resolvers/zod";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { Button } from "./button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "./form";
import { Input } from "./input";

const schema = z.object({
  email: z.string().email({ message: "invalid email" }),
});

type FormValues = z.infer<typeof schema>;

function Harness({ onValid }: { onValid: (values: FormValues) => void }): React.ReactElement {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  return (
    <Form {...form}>
      <form
        onSubmit={(e) => {
          void form.handleSubmit(onValid)(e);
        }}
        noValidate
      >
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>email</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit">submit</Button>
      </form>
    </Form>
  );
}

describe("Form", () => {
  it("surfaces zod errors via FormMessage on invalid submit", async () => {
    const user = userEvent.setup();
    const onValid = vi.fn();
    render(<Harness onValid={onValid} />);

    await user.click(screen.getByRole("button", { name: /submit/i }));

    expect(await screen.findByText(/invalid email/i)).toBeInTheDocument();
    expect(onValid).not.toHaveBeenCalled();
  });

  it("marks the input aria-invalid on invalid submit", async () => {
    const user = userEvent.setup();
    render(<Harness onValid={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /submit/i }));

    const input = await screen.findByLabelText(/email/i);
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("calls onSubmit with parsed values when valid", async () => {
    const user = userEvent.setup();
    const onValid = vi.fn();
    render(<Harness onValid={onValid} />);

    await user.type(screen.getByLabelText(/email/i), "dev@example.com");
    await user.click(screen.getByRole("button", { name: /submit/i }));

    await vi.waitFor(() => {
      expect(onValid).toHaveBeenCalledTimes(1);
    });
    expect(onValid).toHaveBeenCalledWith({ email: "dev@example.com" }, expect.anything());
  });
});
