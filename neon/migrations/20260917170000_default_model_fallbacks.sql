-- NULL keeps existing automation fallback policy; [] explicitly disables it.
-- Additive: older apps and workers can continue reading/writing profiles.
alter table public.profiles
  add column if not exists fallback_model_ids text[];

alter table public.profiles
  add constraint profiles_fallback_model_ids_valid check (
    fallback_model_ids is null or (
      array_position(fallback_model_ids, null) is null
      and array_position(fallback_model_ids, '') is null
    )
  );
